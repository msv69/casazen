// Logica di dominio: notti, conto ospite, registrazioni contabili, tassa di soggiorno
const { db, settings } = require('./db');

const DAY = 86400000;
const toDate = (s) => new Date(s + 'T00:00:00Z');
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => iso(new Date(toDate(s).getTime() + n * DAY));
const nightsBetween = (a, b) => Math.max(0, Math.round((toDate(b) - toDate(a)) / DAY));
const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
// arrotondamento ai 5 centesimi (contanti CHF)
const round05 = (x) => Math.round(x * 20) / 20;

const PAYMENT_ACCOUNTS = { contanti: '1000', carta: '1091', twint: '1091', bonifico: '1020' };
const ACTIVE = "status NOT IN ('cancellata','noshow')";

function getBooking(id) {
  return db.prepare(`
    SELECT b.*, r.name AS room_name, r.type AS room_type,
      g.first_name, g.last_name, g.email, g.phone, g.address, g.zip, g.city, g.country
    FROM bookings b JOIN rooms r ON r.id = b.room_id LEFT JOIN guests g ON g.id = b.guest_id
    WHERE b.id = ?`).get(id);
}

function overlaps(roomId, arrival, departure, excludeId = 0) {
  return db.prepare(`SELECT id, code FROM bookings WHERE room_id = ? AND id != ? AND ${ACTIVE}
    AND arrival < ? AND departure > ?`).get(roomId, excludeId, departure, arrival);
}

function nextBookingCode() {
  const year = new Date().getFullYear();
  const row = db.prepare("SELECT code FROM bookings WHERE code LIKE ? ORDER BY id DESC LIMIT 1").get(`P${year}-%`);
  const n = row ? parseInt(row.code.split('-')[1], 10) + 1 : 1;
  return `P${year}-${String(n).padStart(4, '0')}`;
}

// Calcola le righe del conto: righe automatiche dalla prenotazione + extra inseriti a mano
function computeFolio(bookingId) {
  const s = settings();
  const b = getBooking(bookingId);
  if (!b) return null;
  const nights = nightsBetween(b.arrival, b.departure);
  const vatOn = !!s.vat.registered;
  const vl = vatOn ? Number(s.vat.rate_lodging) : 0;
  const lines = [];
  if (nights > 0 && b.rate_per_night > 0) {
    lines.push({ auto: true, kind: 'alloggio', description: `Pernottamento camera ${b.room_name} (${nights} ${nights === 1 ? 'notte' : 'notti'})`,
      qty: nights, unit_price: b.rate_per_night, vat_rate: vl, account_code: '3400' });
  }
  const persons = (b.adults || 0) + (b.children || 0);
  if (b.breakfast && b.breakfast_price > 0 && nights > 0) {
    lines.push({ auto: true, kind: 'colazione', description: `Colazione (${persons} pers. × ${nights} ${nights === 1 ? 'notte' : 'notti'})`,
      qty: nights * persons, unit_price: b.breakfast_price, vat_rate: vl, account_code: '3410' });
  }
  const tt = Number(s.tourist_tax.soggiorno_per_night) || 0;
  if (tt > 0 && nights > 0 && b.adults > 0) {
    lines.push({ auto: true, kind: 'tassa', description: `Tassa di soggiorno (${b.adults} pers. × ${nights} ${nights === 1 ? 'notte' : 'notti'})`,
      qty: nights * b.adults, unit_price: tt, vat_rate: 0, account_code: '2210' });
  }
  const extras = db.prepare('SELECT * FROM folio_items WHERE booking_id = ? ORDER BY date, id').all(bookingId);
  for (const e of extras) lines.push({ ...e, auto: false, kind: 'extra', vat_rate: vatOn ? e.vat_rate : 0 });

  const vatMap = {};
  let total = 0;
  for (const l of lines) {
    l.total = round2(l.qty * l.unit_price);
    total += l.total;
    if (l.vat_rate > 0) {
      const v = vatMap[l.vat_rate] || (vatMap[l.vat_rate] = { rate: l.vat_rate, gross: 0, vat: 0 });
      v.gross += l.total;
    }
  }
  const vat = Object.values(vatMap).map((v) => ({ rate: v.rate, gross: round2(v.gross), vat: round2(v.gross * v.rate / (100 + v.rate)) }));
  const payments = db.prepare('SELECT * FROM payments WHERE booking_id = ? ORDER BY date, id').all(bookingId);
  const paid = round2(payments.reduce((a, p) => a + p.amount, 0));
  const invoice = db.prepare('SELECT id, number, date, total FROM invoices WHERE booking_id = ? ORDER BY id DESC LIMIT 1').get(bookingId);
  total = round2(total);
  return { booking: b, nights, lines, vat, total, payments, paid, balance: round2(total - paid), invoice };
}

const insJournal = db.prepare(`INSERT INTO journal (date, doc_no, doc_type, description, debit_account, credit_account, amount, source, source_ref, dedupe_key, batch_id)
  VALUES (@date, @doc_no, @doc_type, @description, @debit_account, @credit_account, @amount, @source, @source_ref, @dedupe_key, @batch_id)`);
function post(e) {
  return insJournal.run({ doc_no: null, doc_type: null, description: '', source: 'manuale', source_ref: null, dedupe_key: null, batch_id: null, ...e, amount: round2(e.amount) }).lastInsertRowid;
}

function postPayment(paymentId) {
  const p = db.prepare('SELECT p.*, b.code FROM payments p LEFT JOIN bookings b ON b.id = p.booking_id WHERE p.id = ?').get(paymentId);
  const jid = post({ date: p.date, doc_no: p.code, doc_type: 'INC', description: `Incasso ${p.method}${p.code ? ' prenotazione ' + p.code : ''}${p.note ? ' – ' + p.note : ''}`,
    debit_account: PAYMENT_ACCOUNTS[p.method] || '1000', credit_account: '1100', amount: p.amount, source: 'pagamento', source_ref: String(p.id) });
  db.prepare('UPDATE payments SET journal_id = ? WHERE id = ?').run(jid, paymentId);
}

function createInvoice(bookingId, date) {
  const s = settings();
  const f = computeFolio(bookingId);
  if (!f) throw new Error('Prenotazione non trovata');
  if (f.total <= 0) throw new Error('Il conto è vuoto: niente da fatturare');
  return db.transaction(() => {
    const year = date.slice(0, 4);
    const n = s.invoice.next_number || 1;
    const number = `${s.invoice.prefix || ''}${year}-${String(n).padStart(4, '0')}`;
    const data = { property: s.property, vat_registered: s.vat.registered, payment_days: s.invoice.payment_days, footer: s.invoice.footer, ...f };
    const id = db.prepare('INSERT INTO invoices (number, booking_id, date, total, data) VALUES (?, ?, ?, ?, ?)').run(number, bookingId, date, f.total, JSON.stringify(data)).lastInsertRowid;
    // registrazioni: crediti v/clienti a ricavi (netto), IVA e tassa di soggiorno
    const byAcc = {};
    let vatTotal = 0;
    for (const l of f.lines) {
      const vat = l.vat_rate > 0 ? l.total * l.vat_rate / (100 + l.vat_rate) : 0;
      vatTotal += vat;
      byAcc[l.account_code] = (byAcc[l.account_code] || 0) + l.total - vat;
    }
    for (const [acc, amt] of Object.entries(byAcc)) {
      if (Math.abs(amt) < 0.005) continue;
      post({ date, doc_no: number, doc_type: 'FATT', description: `Fattura ${number} – ${f.booking.last_name || ''} (${f.booking.code})`,
        debit_account: '1100', credit_account: acc, amount: amt, source: 'fattura', source_ref: String(id) });
    }
    if (vatTotal > 0.005) {
      post({ date, doc_no: number, doc_type: 'FATT', description: `IVA fattura ${number}`, debit_account: '1100', credit_account: '2200', amount: vatTotal, source: 'fattura', source_ref: String(id) });
    }
    s.invoice.next_number = n + 1;
    db.prepare("UPDATE settings SET value = ? WHERE key = 'invoice'").run(JSON.stringify(s.invoice));
    return { id, number };
  })();
}

function cancelInvoice(id) {
  db.transaction(() => {
    db.prepare("DELETE FROM journal WHERE source = 'fattura' AND source_ref = ?").run(String(id));
    db.prepare('DELETE FROM invoices WHERE id = ?').run(id);
  })();
}

// Pernottamenti per la notifica OTR, mese per mese (conta le notti che cadono nel periodo)
function touristTaxReport(from, to) {
  const s = settings();
  const rows = db.prepare(`SELECT b.*, r.name AS room_name, g.last_name, g.first_name, g.country, g.nationality
    FROM bookings b JOIN rooms r ON r.id = b.room_id LEFT JOIN guests g ON g.id = b.guest_id
    WHERE b.${ACTIVE} AND b.arrival < ? AND b.departure > ? ORDER BY b.arrival`).all(to, from);
  const detail = [];
  let taxable = 0, exempt = 0;
  for (const b of rows) {
    const start = b.arrival > from ? b.arrival : from;
    const end = b.departure < to ? b.departure : to;
    const n = nightsBetween(start, end);
    if (n <= 0) continue;
    const t = n * (b.adults || 0), e = n * (b.children || 0);
    taxable += t; exempt += e;
    detail.push({ code: b.code, room: b.room_name, guest: `${b.last_name || ''} ${b.first_name || ''}`.trim(), country: b.nationality || b.country || '',
      arrival: b.arrival, departure: b.departure, nights: n, adults: b.adults, children: b.children, taxable_nights: t, exempt_nights: e, channel: b.channel });
  }
  const rs = Number(s.tourist_tax.soggiorno_per_night) || 0;
  const rp = Number(s.tourist_tax.promozione_per_night) || 0;
  return {
    from, to, rates: { soggiorno: rs, promozione: rp, exempt_under_age: s.tourist_tax.exempt_under_age },
    taxable_nights: taxable, exempt_nights: exempt, total_nights: taxable + exempt,
    soggiorno: round2(taxable * rs), promozione: round2(taxable * rp), total: round2(taxable * (rs + rp)), detail,
  };
}

function accountBalances(to) {
  return db.prepare(`SELECT a.code, a.name, a.type,
      COALESCE((SELECT SUM(amount) FROM journal WHERE debit_account = a.code AND date <= ?), 0) AS dare,
      COALESCE((SELECT SUM(amount) FROM journal WHERE credit_account = a.code AND date <= ?), 0) AS avere
    FROM accounts a ORDER BY a.code`).all(to, to).map((a) => ({ ...a, dare: round2(a.dare), avere: round2(a.avere), saldo: round2(a.dare - a.avere) }));
}

module.exports = { toDate, iso, addDays, nightsBetween, round2, round05, getBooking, overlaps, nextBookingCode, computeFolio,
  post, postPayment, createInvoice, cancelInvoice, touristTaxReport, accountBalances, PAYMENT_ACCOUNTS, ACTIVE };
