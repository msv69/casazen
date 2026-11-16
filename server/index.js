// Server API + frontend statico
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const { db, DB_PATH, settings, saveSettings, inferAccountType } = require('./db');
const L = require('./lib');
const { parseLogico, commitLogico } = require('./logico');
const { renderInvoice } = require('./invoice');

const app = express();
const PROD = process.env.NODE_ENV === 'production';
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'same-origin');
  next();
});
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

// ---------- utenti e sessioni ----------
function ensureAdmin() {
  if (db.prepare('SELECT COUNT(*) n FROM users').get().n > 0) return;
  const username = process.env.ADMIN_USER || 'admin';
  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    password = crypto.randomBytes(9).toString('base64url');
    console.log(`\n*** Utente iniziale creato: ${username} / ${password}  (cambia la password dopo il primo accesso)\n`);
  }
  db.prepare('INSERT INTO users (username, name, password_hash, role) VALUES (?, ?, ?, ?)').run(username, 'Amministratore', bcrypt.hashSync(password, 10), 'admin');
}
ensureAdmin();

const SESSION_DAYS = 30;
const loginAttempts = new Map();
const wrap = (fn) => (req, res, next) => { try { const r = fn(req, res, next); if (r && r.catch) r.catch(next); } catch (e) { next(e); } };
const bad = (msg, code = 400) => Object.assign(new Error(msg), { status: code });

app.post('/api/login', wrap((req, res) => {
  const ip = req.ip;
  const a = loginAttempts.get(ip) || { n: 0, t: Date.now() };
  if (Date.now() - a.t > 15 * 60000) { a.n = 0; a.t = Date.now(); }
  if (a.n >= 10) throw bad('Troppi tentativi. Riprova tra 15 minuti.', 429);
  const { username, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim());
  if (!u || !bcrypt.compareSync(String(password || ''), u.password_hash)) {
    a.n++; loginAttempts.set(ip, a);
    throw bad('Nome utente o password errati', 401);
  }
  loginAttempts.delete(ip);
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, u.id, Date.now() + SESSION_DAYS * 86400000);
  res.cookie('sid', token, { httpOnly: true, sameSite: 'lax', secure: PROD, maxAge: SESSION_DAYS * 86400000 });
  res.json({ id: u.id, username: u.username, name: u.name, role: u.role });
}));

function auth(req, res, next) {
  const t = req.cookies.sid;
  const s = t && db.prepare('SELECT s.*, u.username, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE token = ?').get(t);
  if (!s || s.expires_at < Date.now()) return res.status(401).json({ error: 'Accesso richiesto' });
  req.user = { id: s.user_id, username: s.username, name: s.name, role: s.role };
  next();
}
const admin = (req, res, next) => (req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Funzione riservata all\'amministratore' }));

app.use('/api', (req, res, next) => (req.path === '/login' || req.path === '/health' ? next() : auth(req, res, next)));
app.get('/api/health', (req, res) => res.json({
  ok: true,
  interfaccia: fs.existsSync(path.join(__dirname, '..', 'client', 'dist', 'index.html')),
  database: DB_PATH,
  utenti: db.prepare('SELECT COUNT(*) n FROM users').get().n,
}));

app.post('/api/logout', (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(req.cookies.sid);
  res.clearCookie('sid'); res.json({ ok: true });
});
app.get('/api/me', (req, res) => res.json(req.user));
app.post('/api/me/password', wrap((req, res) => {
  const { current, next: np } = req.body;
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(String(current || ''), u.password_hash)) throw bad('La password attuale non è corretta');
  if (!np || String(np).length < 8) throw bad('La nuova password deve avere almeno 8 caratteri');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(np, 10), u.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(u.id, req.cookies.sid);
  res.json({ ok: true });
}));

app.get('/api/users', admin, (req, res) => res.json(db.prepare('SELECT id, username, name, role, created_at FROM users ORDER BY id').all()));
app.post('/api/users', admin, wrap((req, res) => {
  const { username, name, password, role } = req.body;
  if (!username || !password || password.length < 8) throw bad('Inserisci nome utente e una password di almeno 8 caratteri');
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw bad('Nome utente già in uso');
  const id = db.prepare('INSERT INTO users (username, name, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(username.trim(), name || username, bcrypt.hashSync(password, 10), role === 'admin' ? 'admin' : 'reception').lastInsertRowid;
  res.json({ id });
}));
app.delete('/api/users/:id', admin, wrap((req, res) => {
  if (Number(req.params.id) === req.user.id) throw bad('Non puoi eliminare il tuo utente');
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id); res.json({ ok: true });
}));

// ---------- impostazioni ----------
app.get('/api/settings', (req, res) => res.json(settings()));
app.put('/api/settings', admin, wrap((req, res) => {
  const allowed = ['property', 'vat', 'tourist_tax', 'invoice', 'checkin_time', 'checkout_time'];
  const s = {};
  for (const k of allowed) if (req.body[k] !== undefined) s[k] = req.body[k];
  saveSettings(s); res.json(settings());
}));

// ---------- camere ----------
app.get('/api/rooms', (req, res) => res.json(db.prepare('SELECT * FROM rooms ORDER BY active DESC, sort, name').all()));
app.post('/api/rooms', admin, wrap((req, res) => {
  const r = req.body;
  if (!r.name) throw bad('Il nome della camera è obbligatorio');
  const id = db.prepare('INSERT INTO rooms (name, type, capacity, base_rate, floor, notes, sort) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(r.name, r.type || '', r.capacity || 2, r.base_rate || 0, r.floor || '', r.notes || '', r.sort || 0).lastInsertRowid;
  res.json({ id });
}));
app.put('/api/rooms/:id', admin, wrap((req, res) => {
  const r = req.body;
  db.prepare('UPDATE rooms SET name=?, type=?, capacity=?, base_rate=?, floor=?, notes=?, active=?, sort=? WHERE id=?')
    .run(r.name, r.type || '', r.capacity || 2, r.base_rate || 0, r.floor || '', r.notes || '', r.active ? 1 : 0, r.sort || 0, req.params.id);
  res.json({ ok: true });
}));
app.delete('/api/rooms/:id', admin, wrap((req, res) => {
  const used = db.prepare('SELECT COUNT(*) n FROM bookings WHERE room_id = ?').get(req.params.id).n;
  if (used) { db.prepare('UPDATE rooms SET active = 0 WHERE id = ?').run(req.params.id); return res.json({ ok: true, archived: true }); }
  db.prepare('DELETE FROM rooms WHERE id = ?').run(req.params.id); res.json({ ok: true });
}));

// ---------- ospiti ----------
const GUEST_FIELDS = ['first_name', 'last_name', 'birth_date', 'gender', 'nationality', 'address', 'zip', 'city', 'country', 'email', 'phone', 'doc_type', 'doc_number', 'doc_issuer', 'doc_expiry', 'notes'];
function saveGuest(g, id) {
  if (!g.last_name || !String(g.last_name).trim()) throw bad('Il cognome dell\'ospite è obbligatorio');
  const vals = GUEST_FIELDS.map((f) => (g[f] === undefined || g[f] === null || String(g[f]).trim() === '' ? null : String(g[f]).trim()));
  if (id) { db.prepare(`UPDATE guests SET ${GUEST_FIELDS.map((f) => f + '=?').join(',')} WHERE id = ?`).run(...vals, id); return Number(id); }
  return db.prepare(`INSERT INTO guests (${GUEST_FIELDS.join(',')}) VALUES (${GUEST_FIELDS.map(() => '?').join(',')})`).run(...vals).lastInsertRowid;
}
app.get('/api/guests', (req, res) => {
  const q = `%${(req.query.q || '').trim()}%`;
  res.json(db.prepare(`SELECT g.*, (SELECT COUNT(*) FROM bookings b WHERE b.guest_id = g.id) AS stays,
      (SELECT MAX(arrival) FROM bookings b WHERE b.guest_id = g.id) AS last_stay
    FROM guests g WHERE (last_name || ' ' || COALESCE(first_name,'') || ' ' || COALESCE(email,'') || ' ' || COALESCE(phone,'')) LIKE ?
    ORDER BY last_name, first_name LIMIT 300`).all(q));
});
app.get('/api/guests/:id', wrap((req, res) => {
  const g = db.prepare('SELECT * FROM guests WHERE id = ?').get(req.params.id);
  if (!g) throw bad('Ospite non trovato', 404);
  g.bookings = db.prepare(`SELECT b.id, b.code, b.arrival, b.departure, b.status, r.name room_name FROM bookings b JOIN rooms r ON r.id = b.room_id
    WHERE b.guest_id = ? OR b.id IN (SELECT booking_id FROM booking_guests WHERE guest_id = ?) ORDER BY arrival DESC`).all(g.id, g.id);
  res.json(g);
}));
app.post('/api/guests', wrap((req, res) => res.json({ id: saveGuest(req.body) })));
app.put('/api/guests/:id', wrap((req, res) => res.json({ id: saveGuest(req.body, req.params.id) })));
app.delete('/api/guests/:id', wrap((req, res) => {
  const n = db.prepare('SELECT COUNT(*) n FROM bookings WHERE guest_id = ?').get(req.params.id).n;
  if (n) throw bad('L\'ospite ha prenotazioni registrate e non può essere eliminato');
  db.prepare('DELETE FROM guests WHERE id = ?').run(req.params.id); res.json({ ok: true });
}));

// ---------- prenotazioni ----------
const STATUSES = ['opzione', 'confermata', 'checkin', 'checkout', 'cancellata', 'noshow'];
function validateBooking(b, id = 0) {
  if (!b.room_id) throw bad('Scegli la camera');
  if (!b.arrival || !b.departure) throw bad('Inserisci le date di arrivo e partenza');
  if (b.departure <= b.arrival) throw bad('La partenza deve essere dopo l\'arrivo');
  if (b.status && !STATUSES.includes(b.status)) throw bad('Stato non valido');
  if (!['cancellata', 'noshow'].includes(b.status)) {
    const o = L.overlaps(b.room_id, b.arrival, b.departure, id);
    if (o) throw bad(`La camera è già occupata in quelle date (prenotazione ${o.code})`, 409);
  }
  const room = db.prepare('SELECT capacity FROM rooms WHERE id = ?').get(b.room_id);
  if (!room) throw bad('Camera inesistente');
}
app.get('/api/bookings', (req, res) => {
  const { from, to, status, q } = req.query;
  const where = ['1=1']; const p = [];
  if (from) { where.push('b.departure > ?'); p.push(from); }
  if (to) { where.push('b.arrival <= ?'); p.push(to); }
  if (status) { where.push('b.status = ?'); p.push(status); }
  if (q) { where.push("(g.last_name || ' ' || COALESCE(g.first_name,'') || ' ' || b.code) LIKE ?"); p.push(`%${q}%`); }
  const rows = db.prepare(`SELECT b.*, r.name room_name, g.first_name, g.last_name,
      (SELECT COALESCE(SUM(amount),0) FROM payments WHERE booking_id = b.id) paid,
      (SELECT number FROM invoices WHERE booking_id = b.id ORDER BY id DESC LIMIT 1) invoice_number
    FROM bookings b JOIN rooms r ON r.id = b.room_id LEFT JOIN guests g ON g.id = b.guest_id
    WHERE ${where.join(' AND ')} ORDER BY b.arrival DESC LIMIT 500`).all(...p);
  for (const r of rows) r.nights = L.nightsBetween(r.arrival, r.departure);
  res.json(rows);
});
app.get('/api/bookings/:id', wrap((req, res) => {
  const f = L.computeFolio(req.params.id);
  if (!f) throw bad('Prenotazione non trovata', 404);
  f.guest = f.booking.guest_id ? db.prepare('SELECT * FROM guests WHERE id = ?').get(f.booking.guest_id) : null;
  f.companions = db.prepare('SELECT g.* FROM booking_guests bg JOIN guests g ON g.id = bg.guest_id WHERE bg.booking_id = ? AND g.id != COALESCE(?, -1)').all(req.params.id, f.booking.guest_id);
  res.json(f);
}));
function bookingValues(b) {
  return [b.room_id, b.guest_id || null, b.arrival, b.departure, Math.max(1, b.adults || 1), Math.max(0, b.children || 0), b.status || 'confermata',
    b.channel || 'Diretto', Number(b.rate_per_night) || 0, b.breakfast ? 1 : 0, Number(b.breakfast_price) || 0, b.notes || ''];
}
app.post('/api/bookings', wrap((req, res) => {
  const b = req.body;
  const id = db.transaction(() => {
    if (!b.guest_id && b.guest) b.guest_id = saveGuest(b.guest);
    validateBooking(b);
    return db.prepare(`INSERT INTO bookings (room_id, guest_id, arrival, departure, adults, children, status, channel, rate_per_night, breakfast, breakfast_price, notes, code)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(...bookingValues(b), L.nextBookingCode()).lastInsertRowid;
  })();
  res.json({ id });
}));
app.put('/api/bookings/:id', wrap((req, res) => {
  const b = req.body; const id = Number(req.params.id);
  const cur = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
  if (!cur) throw bad('Prenotazione non trovata', 404);
  const inv = db.prepare('SELECT number FROM invoices WHERE booking_id = ?').get(id);
  if (inv && (b.arrival !== cur.arrival || b.departure !== cur.departure || Number(b.rate_per_night) !== cur.rate_per_night || b.adults !== cur.adults))
    throw bad(`La prenotazione è già fatturata (${inv.number}). Annulla la fattura per modificare date, tariffa o persone.`);
  db.transaction(() => {
    if (b.guest && !b.guest_id) b.guest_id = saveGuest(b.guest);
    validateBooking(b, id);
    db.prepare(`UPDATE bookings SET room_id=?, guest_id=?, arrival=?, departure=?, adults=?, children=?, status=?, channel=?, rate_per_night=?, breakfast=?, breakfast_price=?, notes=? WHERE id=?`)
      .run(...bookingValues(b), id);
  })();
  res.json({ ok: true });
}));
app.post('/api/bookings/:id/status', wrap((req, res) => {
  const { status } = req.body;
  if (!STATUSES.includes(status)) throw bad('Stato non valido');
  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!['cancellata', 'noshow'].includes(status)) { const o = L.overlaps(b.room_id, b.arrival, b.departure, b.id); if (o) throw bad(`Camera occupata (prenotazione ${o.code})`, 409); }
  db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(status, req.params.id); res.json({ ok: true });
}));
app.delete('/api/bookings/:id', wrap((req, res) => {
  const id = req.params.id;
  if (db.prepare('SELECT 1 FROM payments WHERE booking_id = ?').get(id) || db.prepare('SELECT 1 FROM invoices WHERE booking_id = ?').get(id))
    throw bad('La prenotazione ha pagamenti o fatture: impostala come cancellata invece di eliminarla');
  db.prepare('DELETE FROM bookings WHERE id = ?').run(id); res.json({ ok: true });
}));

// check-in: dati dell'ospite principale + accompagnatori (per la notifica)
app.post('/api/bookings/:id/checkin', wrap((req, res) => {
  const id = Number(req.params.id);
  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
  if (!b) throw bad('Prenotazione non trovata', 404);
  const { guest, companions = [], checkin = true } = req.body;
  if (!guest) throw bad('Dati dell\'ospite mancanti');
  db.transaction(() => {
    const gid = saveGuest(guest, b.guest_id || guest.id);
    if (checkin) db.prepare("UPDATE bookings SET guest_id = ?, status = 'checkin', checkin_at = CURRENT_TIMESTAMP WHERE id = ?").run(gid, id);
    else db.prepare('UPDATE bookings SET guest_id = ? WHERE id = ?').run(gid, id);
    db.prepare('DELETE FROM booking_guests WHERE booking_id = ?').run(id);
    const ins = db.prepare('INSERT OR IGNORE INTO booking_guests (booking_id, guest_id) VALUES (?, ?)');
    ins.run(id, gid);
    for (const c of companions) { if (c && c.last_name) ins.run(id, saveGuest(c, c.id)); }
  })();
  res.json({ ok: true });
}));
app.post('/api/bookings/:id/checkout', wrap((req, res) => {
  const id = Number(req.params.id);
  const { invoice = true, payment } = req.body || {};
  const today = new Date().toISOString().slice(0, 10);
  const result = {};
  if (payment && Number(payment.amount) > 0) {
    const pid = db.prepare('INSERT INTO payments (booking_id, date, amount, method, note) VALUES (?, ?, ?, ?, ?)').run(id, payment.date || today, L.round2(Number(payment.amount)), payment.method || 'contanti', payment.note || '').lastInsertRowid;
    L.postPayment(pid);
  }
  if (invoice && !db.prepare('SELECT 1 FROM invoices WHERE booking_id = ?').get(id)) result.invoice = L.createInvoice(id, today);
  db.prepare("UPDATE bookings SET status = 'checkout', checkout_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
  res.json(result);
}));

// extra sul conto
app.post('/api/bookings/:id/items', wrap((req, res) => {
  const i = req.body;
  if (db.prepare('SELECT 1 FROM invoices WHERE booking_id = ?').get(req.params.id)) throw bad('Conto già fatturato: annulla la fattura per aggiungere voci');
  if (!i.description) throw bad('Descrivi la voce');
  const id = db.prepare('INSERT INTO folio_items (booking_id, date, description, qty, unit_price, vat_rate, account_code) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(req.params.id, i.date || new Date().toISOString().slice(0, 10), i.description, Number(i.qty) || 1, Number(i.unit_price) || 0, Number(i.vat_rate ?? 8.1), i.account_code || '3420').lastInsertRowid;
  res.json({ id });
}));
app.delete('/api/items/:id', wrap((req, res) => {
  const it = db.prepare('SELECT booking_id FROM folio_items WHERE id = ?').get(req.params.id);
  if (it && db.prepare('SELECT 1 FROM invoices WHERE booking_id = ?').get(it.booking_id)) throw bad('Conto già fatturato');
  db.prepare('DELETE FROM folio_items WHERE id = ?').run(req.params.id); res.json({ ok: true });
}));

// pagamenti
app.post('/api/bookings/:id/payments', wrap((req, res) => {
  const p = req.body;
  const amount = L.round2(Number(p.amount));
  if (!amount) throw bad('Inserisci l\'importo');
  if (!L.PAYMENT_ACCOUNTS[p.method]) throw bad('Metodo di pagamento non valido');
  const id = db.transaction(() => {
    const pid = db.prepare('INSERT INTO payments (booking_id, date, amount, method, note) VALUES (?, ?, ?, ?, ?)').run(req.params.id, p.date || new Date().toISOString().slice(0, 10), amount, p.method, p.note || '').lastInsertRowid;
    L.postPayment(pid); return pid;
  })();
  res.json({ id });
}));
app.delete('/api/payments/:id', wrap((req, res) => {
  db.transaction(() => {
    const p = db.prepare('SELECT * FROM payments WHERE id = ?').get(req.params.id);
    if (p?.journal_id) db.prepare('DELETE FROM journal WHERE id = ?').run(p.journal_id);
    db.prepare('DELETE FROM payments WHERE id = ?').run(req.params.id);
  })();
  res.json({ ok: true });
}));

// fatture
app.get('/api/invoices', (req, res) => {
  res.json(db.prepare(`SELECT i.id, i.number, i.date, i.total, i.booking_id, b.code, g.last_name, g.first_name,
      (SELECT COALESCE(SUM(amount),0) FROM payments WHERE booking_id = i.booking_id) paid
    FROM invoices i LEFT JOIN bookings b ON b.id = i.booking_id LEFT JOIN guests g ON g.id = b.guest_id ORDER BY i.id DESC LIMIT 500`).all());
});
app.post('/api/bookings/:id/invoice', wrap((req, res) => {
  if (db.prepare('SELECT 1 FROM invoices WHERE booking_id = ?').get(req.params.id)) throw bad('Esiste già una fattura per questa prenotazione');
  res.json(L.createInvoice(Number(req.params.id), req.body.date || new Date().toISOString().slice(0, 10)));
}));
app.delete('/api/invoices/:id', admin, wrap((req, res) => { L.cancelInvoice(req.params.id); res.json({ ok: true }); }));
app.get('/api/invoices/:id/print', wrap((req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) throw bad('Fattura non trovata', 404);
  const data = JSON.parse(inv.data);
  data.paid = L.round2(db.prepare('SELECT COALESCE(SUM(amount),0) v FROM payments WHERE booking_id = ?').get(inv.booking_id).v);
  res.type('html').send(renderInvoice(inv, data));
}));

// ---------- planning e cruscotto ----------
app.get('/api/planning', (req, res) => {
  const from = req.query.from || new Date().toISOString().slice(0, 10);
  const days = Math.min(62, Math.max(1, Number(req.query.days) || 14));
  const to = L.addDays(from, days);
  const rooms = db.prepare('SELECT * FROM rooms WHERE active = 1 ORDER BY sort, name').all();
  const bookings = db.prepare(`SELECT b.id, b.code, b.room_id, b.arrival, b.departure, b.status, b.adults, b.children, b.channel, g.last_name, g.first_name,
      (SELECT COALESCE(SUM(amount),0) FROM payments WHERE booking_id = b.id) paid
    FROM bookings b LEFT JOIN guests g ON g.id = b.guest_id
    WHERE b.${L.ACTIVE} AND b.arrival < ? AND b.departure > ?`).all(to, from);
  res.json({ from, to, days, rooms, bookings });
});

app.get('/api/dashboard', (req, res) => {
  const today = req.query.date || new Date().toISOString().slice(0, 10);
  const q = (sql, ...p) => db.prepare(sql).all(...p);
  const sel = `SELECT b.id, b.code, b.arrival, b.departure, b.status, b.adults, b.children, r.name room_name, g.last_name, g.first_name FROM bookings b JOIN rooms r ON r.id = b.room_id LEFT JOIN guests g ON g.id = b.guest_id`;
  const arrivals = q(`${sel} WHERE b.arrival = ? AND b.${L.ACTIVE} ORDER BY r.sort, r.name`, today);
  const departures = q(`${sel} WHERE b.departure = ? AND b.${L.ACTIVE} ORDER BY r.sort, r.name`, today);
  const inhouse = q(`${sel} WHERE b.arrival <= ? AND b.departure > ? AND b.status = 'checkin' ORDER BY r.sort, r.name`, today, today);
  const rooms = db.prepare('SELECT COUNT(*) n FROM rooms WHERE active = 1').get().n;
  const series = [];
  for (let i = 0; i < 14; i++) {
    const d = L.addDays(today, i);
    const n = db.prepare(`SELECT COUNT(*) n FROM bookings WHERE arrival <= ? AND departure > ? AND ${L.ACTIVE}`).get(d, d).n;
    series.push({ date: d, occupied: n, rooms });
  }
  const mStart = today.slice(0, 8) + '01';
  const mEnd = L.addDays(L.iso(new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7), 1))), 0);
  const days = L.nightsBetween(mStart, mEnd);
  let roomNights = 0;
  for (const b of q(`SELECT arrival, departure FROM bookings WHERE ${L.ACTIVE} AND arrival < ? AND departure > ?`, mEnd, mStart)) {
    roomNights += L.nightsBetween(b.arrival > mStart ? b.arrival : mStart, b.departure < mEnd ? b.departure : mEnd);
  }
  const open = q(`SELECT b.id, b.code, b.departure, g.last_name, g.first_name, r.name room_name,
      (SELECT COALESCE(SUM(amount),0) FROM payments WHERE booking_id = b.id) paid,
      (SELECT total FROM invoices WHERE booking_id = b.id ORDER BY id DESC LIMIT 1) invoiced
    FROM bookings b JOIN rooms r ON r.id = b.room_id LEFT JOIN guests g ON g.id = b.guest_id WHERE b.status = 'checkout'`)
    .map((r) => ({ ...r, balance: L.round2((r.invoiced || 0) - r.paid) })).filter((r) => r.balance > 0.04);
  const out = { today, arrivals, departures, inhouse, rooms, series, occupancy_month: rooms && days ? roomNights / (rooms * days) : 0, room_nights_month: roomNights, open_balances: open };
  if (req.user.role === 'admin') {
    const rev = db.prepare(`SELECT COALESCE(SUM(CASE WHEN a1.type='ricavo' THEN j.amount ELSE 0 END),0) - COALESCE(SUM(CASE WHEN a2.type='ricavo' THEN j.amount ELSE 0 END),0) v
      FROM journal j JOIN accounts a1 ON a1.code = j.credit_account JOIN accounts a2 ON a2.code = j.debit_account WHERE j.date >= ? AND j.date < ?`).get(mStart, mEnd).v;
    const liq = L.accountBalances(today).filter((a) => /^10/.test(a.code));
    out.revenue_month = L.round2(rev);
    out.liquidity = liq.map((a) => ({ code: a.code, name: a.name, saldo: a.saldo }));
  }
  res.json(out);
});

// ---------- tassa di soggiorno e registro ospiti ----------
const csv = (rows, cols) => '﻿' + [cols.map((c) => c[1]).join(';'), ...rows.map((r) => cols.map(([k]) => {
  const v = r[k] ?? ''; const s = String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}).join(';'))].join('\r\n');
function monthRange(req) {
  const from = req.query.from || new Date().toISOString().slice(0, 8) + '01';
  const to = req.query.to || L.iso(new Date(Date.UTC(+from.slice(0, 4), +from.slice(5, 7), 1)));
  return { from, to };
}
app.get('/api/reports/tourist-tax', (req, res) => {
  const { from, to } = monthRange(req);
  const r = L.touristTaxReport(from, to);
  if (req.query.format === 'csv') {
    res.attachment(`pernottamenti_${from}_${to}.csv`).type('text/csv');
    return res.send(csv(r.detail, [['code', 'Prenotazione'], ['guest', 'Ospite'], ['country', 'Provenienza'], ['room', 'Camera'], ['arrival', 'Arrivo'], ['departure', 'Partenza'],
      ['nights', 'Notti nel periodo'], ['adults', 'Adulti'], ['children', 'Bambini esenti'], ['taxable_nights', 'Pernottamenti imponibili'], ['exempt_nights', 'Pernottamenti esenti']]));
  }
  res.json(r);
});
app.post('/api/reports/tourist-tax/post', admin, wrap((req, res) => {
  const { from, to } = req.body;
  const r = L.touristTaxReport(from, to);
  if (!r.promozione) throw bad('Nessun importo da registrare');
  const key = `PROMO|${from}|${to}`;
  if (db.prepare('SELECT 1 FROM journal WHERE dedupe_key = ?').get(key)) throw bad('Tassa di promozione già registrata per questo periodo');
  L.post({ date: L.addDays(to, -1), doc_type: 'OTR', description: `Tassa di promozione ${from} – ${L.addDays(to, -1)} (${r.taxable_nights} pernottamenti)`,
    debit_account: '6700', credit_account: '2210', amount: r.promozione, source: 'otr', dedupe_key: key });
  res.json({ ok: true, amount: r.promozione });
}));
app.get('/api/reports/guest-register', (req, res) => {
  const { from, to } = monthRange(req);
  const rows = db.prepare(`SELECT b.code, b.arrival, b.departure, r.name room, g.last_name, g.first_name, g.birth_date, g.gender, g.nationality,
      g.address, g.zip, g.city, g.country, g.doc_type, g.doc_number, g.doc_issuer, g.doc_expiry
    FROM bookings b JOIN rooms r ON r.id = b.room_id
    JOIN guests g ON g.id IN (SELECT guest_id FROM booking_guests WHERE booking_id = b.id UNION SELECT b.guest_id)
    WHERE b.${L.ACTIVE} AND b.arrival >= ? AND b.arrival < ? ORDER BY b.arrival, b.code, g.last_name`).all(from, to);
  if (req.query.format === 'csv') {
    res.attachment(`registro_ospiti_${from}_${to}.csv`).type('text/csv');
    return res.send(csv(rows, [['arrival', 'Arrivo'], ['departure', 'Partenza'], ['room', 'Camera'], ['last_name', 'Cognome'], ['first_name', 'Nome'], ['birth_date', 'Data di nascita'],
      ['gender', 'Sesso'], ['nationality', 'Nazionalità'], ['address', 'Indirizzo'], ['zip', 'NPA'], ['city', 'Località'], ['country', 'Paese'], ['doc_type', 'Documento'],
      ['doc_number', 'Numero documento'], ['doc_issuer', 'Rilasciato da'], ['doc_expiry', 'Scadenza'], ['code', 'Prenotazione']]));
  }
  res.json({ from, to, rows });
});

// ---------- contabilità (solo amministratore) ----------
const acct = express.Router();
acct.use(admin);
acct.get('/accounts', (req, res) => res.json(L.accountBalances(req.query.to || '9999-12-31')));
acct.post('/accounts', wrap((req, res) => {
  const { code, name, type } = req.body;
  if (!/^\d{3,6}$/.test(String(code || ''))) throw bad('Il numero di conto deve avere da 3 a 6 cifre');
  if (!name) throw bad('Inserisci il nome del conto');
  if (db.prepare('SELECT 1 FROM accounts WHERE code = ?').get(code)) throw bad('Conto già esistente');
  db.prepare('INSERT INTO accounts (code, name, type) VALUES (?, ?, ?)').run(code, name, type || inferAccountType(code, name)); res.json({ ok: true });
}));
acct.put('/accounts/:code', wrap((req, res) => {
  db.prepare('UPDATE accounts SET name = ?, type = ? WHERE code = ?').run(req.body.name, req.body.type, req.params.code); res.json({ ok: true });
}));
acct.delete('/accounts/:code', wrap((req, res) => {
  if (db.prepare('SELECT 1 FROM journal WHERE debit_account = ? OR credit_account = ?').get(req.params.code, req.params.code)) throw bad('Il conto ha movimenti e non può essere eliminato');
  db.prepare('DELETE FROM accounts WHERE code = ?').run(req.params.code); res.json({ ok: true });
}));
acct.get('/journal', (req, res) => {
  const { from = '0000-01-01', to = '9999-12-31', q, source } = req.query;
  const where = ['j.date >= ?', 'j.date <= ?']; const p = [from, to];
  if (q) { where.push("(j.description || ' ' || COALESCE(j.doc_no,'') || ' ' || j.debit_account || ' ' || j.credit_account) LIKE ?"); p.push(`%${q}%`); }
  if (source) { where.push('j.source = ?'); p.push(source); }
  res.json(db.prepare(`SELECT j.*, ad.name debit_name, ac.name credit_name FROM journal j JOIN accounts ad ON ad.code = j.debit_account JOIN accounts ac ON ac.code = j.credit_account
    WHERE ${where.join(' AND ')} ORDER BY j.date DESC, j.id DESC LIMIT 2000`).all(...p));
});
function checkEntry(e) {
  if (!e.date) throw bad('Inserisci la data');
  if (!(Number(e.amount) > 0)) throw bad('L\'importo deve essere positivo');
  if (e.debit_account === e.credit_account) throw bad('Dare e avere devono essere conti diversi');
  for (const c of [e.debit_account, e.credit_account]) if (!db.prepare('SELECT 1 FROM accounts WHERE code = ?').get(c)) throw bad(`Conto ${c} inesistente`);
}
acct.post('/journal', wrap((req, res) => { checkEntry(req.body); res.json({ id: L.post({ ...req.body, amount: Number(req.body.amount), source: 'manuale' }) }); }));
acct.put('/journal/:id', wrap((req, res) => {
  const e = req.body; checkEntry(e);
  const cur = db.prepare('SELECT source FROM journal WHERE id = ?').get(req.params.id);
  if (cur && ['fattura', 'pagamento'].includes(cur.source)) throw bad('Questa registrazione è generata da una fattura o da un pagamento: modificala da lì');
  db.prepare('UPDATE journal SET date=?, doc_no=?, doc_type=?, description=?, debit_account=?, credit_account=?, amount=? WHERE id=?')
    .run(e.date, e.doc_no || null, e.doc_type || null, e.description || '', e.debit_account, e.credit_account, L.round2(Number(e.amount)), req.params.id);
  res.json({ ok: true });
}));
acct.delete('/journal/:id', wrap((req, res) => {
  const cur = db.prepare('SELECT source FROM journal WHERE id = ?').get(req.params.id);
  if (cur && ['fattura', 'pagamento'].includes(cur.source)) throw bad('Questa registrazione è generata da una fattura o da un pagamento: annullala da lì');
  db.prepare('DELETE FROM journal WHERE id = ?').run(req.params.id); res.json({ ok: true });
}));
acct.get('/ledger/:code', wrap((req, res) => {
  const { from = '0000-01-01', to = '9999-12-31' } = req.query;
  const a = db.prepare('SELECT * FROM accounts WHERE code = ?').get(req.params.code);
  if (!a) throw bad('Conto inesistente', 404);
  const c = a.code;
  const prev = db.prepare(`SELECT COALESCE(SUM(CASE WHEN debit_account = ? THEN amount ELSE 0 END),0) - COALESCE(SUM(CASE WHEN credit_account = ? THEN amount ELSE 0 END),0) s
    FROM journal WHERE date < ? AND (debit_account = ? OR credit_account = ?)`).get(c, c, from, c, c).s;
  let saldo = L.round2(prev);
  const rows = db.prepare(`SELECT j.*, CASE WHEN j.debit_account = ? THEN j.credit_account ELSE j.debit_account END contra,
      (SELECT name FROM accounts WHERE code = CASE WHEN j.debit_account = ? THEN j.credit_account ELSE j.debit_account END) contra_name
    FROM journal j WHERE (debit_account = ? OR credit_account = ?) AND date >= ? AND date <= ? ORDER BY date, id`).all(c, c, c, c, from, to)
    .map((j) => { const dare = j.debit_account === c ? j.amount : 0; const avere = j.credit_account === c ? j.amount : 0; saldo = L.round2(saldo + dare - avere); return { ...j, dare, avere, saldo }; });
  res.json({ account: a, from, to, opening: L.round2(prev), rows, closing: saldo,
    dare: L.round2(rows.reduce((s, r) => s + r.dare, 0)), avere: L.round2(rows.reduce((s, r) => s + r.avere, 0)) });
}));
acct.get('/reports/monthly', (req, res) => {
  const year = String(req.query.year || new Date().getFullYear());
  const months = Array.from({ length: 12 }, (_, i) => ({ month: `${year}-${String(i + 1).padStart(2, '0')}`, ricavi: 0, costi: 0, entrate: 0, uscite: 0, byAccount: {} }));
  const rows = db.prepare(`SELECT j.*, ad.type dt, ac.type ct, ad.name dn, ac.name cn FROM journal j JOIN accounts ad ON ad.code = j.debit_account JOIN accounts ac ON ac.code = j.credit_account
    WHERE substr(j.date,1,4) = ?`).all(year);
  const byAcc = {};
  for (const j of rows) {
    const m = months[+j.date.slice(5, 7) - 1];
    const add = (code, name, type, v) => { const k = code; byAcc[k] = byAcc[k] || { code, name, type, months: Array(12).fill(0), total: 0 }; byAcc[k].months[+j.date.slice(5, 7) - 1] += v; byAcc[k].total += v; };
    if (j.ct === 'ricavo') { m.ricavi += j.amount; add(j.credit_account, j.cn, 'ricavo', j.amount); }
    if (j.dt === 'ricavo') { m.ricavi -= j.amount; add(j.debit_account, j.dn, 'ricavo', -j.amount); }
    if (j.dt === 'costo') { m.costi += j.amount; add(j.debit_account, j.dn, 'costo', j.amount); }
    if (j.ct === 'costo') { m.costi -= j.amount; add(j.credit_account, j.cn, 'costo', -j.amount); }
    const liqD = /^10/.test(j.debit_account), liqC = /^10/.test(j.credit_account);
    if (liqD && !liqC && j.dt !== 'chiusura' && j.ct !== 'chiusura') m.entrate += j.amount;
    if (liqC && !liqD && j.dt !== 'chiusura' && j.ct !== 'chiusura') m.uscite += j.amount;
  }
  for (const m of months) { for (const k of ['ricavi', 'costi', 'entrate', 'uscite']) m[k] = L.round2(m[k]); m.risultato = L.round2(m.ricavi - m.costi); delete m.byAccount; }
  const accounts = Object.values(byAcc).map((a) => ({ ...a, months: a.months.map(L.round2), total: L.round2(a.total) })).sort((a, b) => a.code.localeCompare(b.code));
  res.json({ year, months, accounts });
});
acct.get('/reports/vat', (req, res) => {
  const { from, to } = monthRange(req);
  const inv = db.prepare('SELECT data FROM invoices WHERE date >= ? AND date < ?').all(from, to);
  const map = {}; let gross = 0, exempt = 0;
  for (const i of inv) {
    const d = JSON.parse(i.data);
    gross += d.total;
    for (const v of d.vat) { map[v.rate] = map[v.rate] || { rate: v.rate, gross: 0, vat: 0 }; map[v.rate].gross += v.gross; map[v.rate].vat += v.vat; }
    exempt += d.lines.filter((l) => !l.vat_rate).reduce((a, l) => a + l.total, 0);
  }
  const pre = db.prepare("SELECT COALESCE(SUM(amount),0) v FROM journal WHERE debit_account = '1170' AND date >= ? AND date < ?").get(from, to).v;
  const rates = Object.values(map).map((v) => ({ rate: v.rate, gross: L.round2(v.gross), net: L.round2(v.gross - v.vat), vat: L.round2(v.vat) }));
  const due = L.round2(rates.reduce((a, r) => a + r.vat, 0));
  res.json({ from, to, invoices: inv.length, gross: L.round2(gross), exempt: L.round2(exempt), rates, vat_due: due, input_vat: L.round2(pre), payable: L.round2(due - pre) });
});
acct.get('/export/journal.csv', (req, res) => {
  const { from = '0000-01-01', to = '9999-12-31' } = req.query;
  const rows = db.prepare('SELECT * FROM journal WHERE date >= ? AND date <= ? ORDER BY date, id').all(from, to)
    .map((r) => ({ ...r, date: r.date.split('-').reverse().join('.'), amount: r.amount.toFixed(2) }));
  res.attachment(`registrazioni_${from}_${to}.csv`).type('text/csv');
  res.send(csv(rows, [['date', 'Data'], ['doc_no', 'N. Doc'], ['doc_type', 'Tipo Doc'], ['description', 'Descrizione'], ['debit_account', 'Conto Dare'], ['credit_account', 'Conto Avere'], ['amount', 'Importo CHF']]));
});

// importazione Logico
const previews = new Map();
acct.post('/import/logico/preview', upload.single('file'), wrap((req, res) => {
  if (!req.file) throw bad('Seleziona un file');
  const parsed = parseLogico(req.file.buffer, req.file.originalname, { account: req.body.account || undefined });
  const token = crypto.randomBytes(16).toString('hex');
  previews.set(token, { parsed, filename: req.file.originalname, at: Date.now() });
  for (const [k, v] of previews) if (Date.now() - v.at > 30 * 60000) previews.delete(k);
  res.json({ token, filename: req.file.originalname, ...parsed });
}));
acct.post('/import/logico/commit', wrap((req, res) => {
  const p = previews.get(req.body.token);
  if (!p) throw bad('Anteprima scaduta: carica di nuovo il file');
  previews.delete(req.body.token);
  p.parsed.renameAccounts = req.body.renameAccounts !== false;
  res.json(commitLogico(p.parsed, p.filename, req.user.id));
}));
acct.get('/import/batches', (req, res) => res.json(db.prepare(`SELECT b.*, u.username, (SELECT COUNT(*) FROM journal WHERE batch_id = b.id) remaining FROM import_batches b LEFT JOIN users u ON u.id = b.user_id ORDER BY b.id DESC`).all()));
acct.delete('/import/batches/:id', wrap((req, res) => {
  db.transaction(() => { db.prepare('DELETE FROM journal WHERE batch_id = ?').run(req.params.id); db.prepare('DELETE FROM import_batches WHERE id = ?').run(req.params.id); })();
  res.json({ ok: true });
}));
acct.get('/backup', (req, res) => {
  const file = path.join(path.dirname(DB_PATH), `backup-${Date.now()}.db`);
  db.backup(file).then(() => res.download(file, `hotel-backup-${new Date().toISOString().slice(0, 10)}.db`, () => fs.unlink(file, () => {})));
});
app.use('/api', acct);

app.use('/api', (req, res) => res.status(404).json({ error: 'Risorsa inesistente' }));
app.use((err, req, res, next) => {
  if (!err.status) console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Errore interno: ' + err.message });
});

// frontend
const DIST = path.join(__dirname, '..', 'client', 'dist');
const HAS_UI = fs.existsSync(path.join(DIST, 'index.html'));
console.log(HAS_UI ? `Interfaccia trovata in ${DIST}` : `ATTENZIONE: interfaccia non compilata (manca ${DIST}). Esegui "npm run build".`);
if (HAS_UI) {
  app.use(express.static(DIST, {
    index: false,
    setHeaders: (res, p) => {
      // i file in /assets hanno l'hash nel nome: si possono tenere in cache a lungo; tutto il resto va sempre ricontrollato
      if (p.includes(`${path.sep}assets${path.sep}`)) res.set('Cache-Control', 'public, max-age=31536000, immutable');
      else res.set('Cache-Control', 'no-cache');
    },
  }));
}
// un file statico mancante (es. /assets/vecchio.js) deve dare 404, non la pagina HTML
app.get(/\.[a-z0-9]{2,5}$/i, (req, res) => res.status(404).type('text').send('File non trovato'));
app.get(/^(?!\/api).*/, (req, res) => {
  if (!HAS_UI) {
    return res.status(503).type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reception</title><body style="font-family:system-ui,sans-serif;max-width:560px;margin:60px auto;padding:0 16px;line-height:1.5;color:#263033">
<h1 style="font-size:1.4rem">L'interfaccia non è stata compilata</h1>
<p>Il server funziona, ma manca la cartella <code>client/dist</code>. Esegui <code>npm run build</code> prima di <code>npm start</code>.
Su Railway controlla che venga usato il <code>Dockerfile</code> del progetto (file <code>railway.json</code> nella radice del repository).</p></body>`);
  }
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(DIST, 'index.html'));
});

const PORT = process.env.PORT || 3000;
if (require.main === module) app.listen(PORT, () => console.log(`Gestionale in ascolto su http://localhost:${PORT}`));
module.exports = app;
