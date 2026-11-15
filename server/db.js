// Database SQLite: schema, migrazioni e dati iniziali
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'hotel.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT,
  password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'reception',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT, capacity INTEGER DEFAULT 2,
  base_rate REAL DEFAULT 0, floor TEXT, notes TEXT, active INTEGER DEFAULT 1, sort INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS guests (
  id INTEGER PRIMARY KEY, first_name TEXT, last_name TEXT NOT NULL, birth_date TEXT, gender TEXT,
  nationality TEXT, address TEXT, zip TEXT, city TEXT, country TEXT, email TEXT, phone TEXT,
  doc_type TEXT, doc_number TEXT, doc_issuer TEXT, doc_expiry TEXT, notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY, code TEXT UNIQUE, room_id INTEGER NOT NULL REFERENCES rooms(id),
  guest_id INTEGER REFERENCES guests(id), arrival TEXT NOT NULL, departure TEXT NOT NULL,
  adults INTEGER DEFAULT 1, children INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'confermata', channel TEXT DEFAULT 'Diretto',
  rate_per_night REAL DEFAULT 0, breakfast INTEGER DEFAULT 0, breakfast_price REAL DEFAULT 0,
  notes TEXT, checkin_at TEXT, checkout_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_bookings_dates ON bookings(arrival, departure);

CREATE TABLE IF NOT EXISTS booking_guests (
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  guest_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  PRIMARY KEY (booking_id, guest_id)
);

CREATE TABLE IF NOT EXISTS folio_items (
  id INTEGER PRIMARY KEY, booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  date TEXT, description TEXT NOT NULL, qty REAL DEFAULT 1, unit_price REAL DEFAULT 0,
  vat_rate REAL DEFAULT 8.1, account_code TEXT DEFAULT '3420'
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY, booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
  date TEXT NOT NULL, amount REAL NOT NULL, method TEXT NOT NULL, note TEXT, journal_id INTEGER
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY, number TEXT UNIQUE NOT NULL, booking_id INTEGER REFERENCES bookings(id),
  date TEXT NOT NULL, total REAL NOT NULL, data TEXT NOT NULL, journal_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS accounts (
  code TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS journal (
  id INTEGER PRIMARY KEY, date TEXT NOT NULL, doc_no TEXT, doc_type TEXT, description TEXT,
  debit_account TEXT NOT NULL REFERENCES accounts(code),
  credit_account TEXT NOT NULL REFERENCES accounts(code),
  amount REAL NOT NULL, source TEXT DEFAULT 'manuale', source_ref TEXT, dedupe_key TEXT,
  batch_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_journal_date ON journal(date);
CREATE INDEX IF NOT EXISTS idx_journal_dedupe ON journal(dedupe_key);

CREATE TABLE IF NOT EXISTS import_batches (
  id INTEGER PRIMARY KEY, filename TEXT, account TEXT, period TEXT, rows INTEGER,
  skipped INTEGER, imported_at TEXT DEFAULT CURRENT_TIMESTAMP, user_id INTEGER
);
`);

// Piano contabile PMI svizzero (estratto) adattato a un affittacamere,
// con i codici usati anche da Logico.
const ACCOUNTS = [
  ['1000', 'Cassa', 'attivo'],
  ['1020', 'Banca c/c', 'attivo'],
  ['1091', 'Transito carte e TWINT', 'attivo'],
  ['1100', 'Crediti v/clienti', 'attivo'],
  ['1170', 'IVA precedente', 'attivo'],
  ['1300', 'Ratei e risconti attivi', 'attivo'],
  ['1500', 'Mobilio e attrezzature', 'attivo'],
  ['2000', 'Debiti v/fornitori', 'passivo'],
  ['2030', 'Acconti da clienti', 'passivo'],
  ['2200', 'IVA dovuta', 'passivo'],
  ['2210', 'Tassa di soggiorno da versare (OTR)', 'passivo'],
  ['2270', 'Debiti assicurazioni sociali', 'passivo'],
  ['2800', 'Capitale proprio', 'passivo'],
  ['3400', 'Ricavi alloggio', 'ricavo'],
  ['3410', 'Ricavi colazioni', 'ricavo'],
  ['3420', 'Ricavi servizi extra', 'ricavo'],
  ['4000', 'Acquisti colazioni e consumabili', 'costo'],
  ['4400', 'Commissioni portali di prenotazione', 'costo'],
  ['5000', 'Salari e stipendi', 'costo'],
  ['5700', 'Oneri sociali', 'costo'],
  ['6100', 'Affitti e locazioni', 'costo'],
  ['6200', 'Manutenzione e pulizia', 'costo'],
  ['6300', 'Assicurazioni', 'costo'],
  ['6400', 'Energia e acqua', 'costo'],
  ['6500', 'Spese amministrative', 'costo'],
  ['6570', 'Informatica e software', 'costo'],
  ['6600', 'Pubblicità', 'costo'],
  ['6700', 'Tassa di promozione turistica', 'costo'],
  ['6900', 'Oneri finanziari e spese bancarie', 'costo'],
  ['6950', 'Interessi attivi', 'ricavo'],
  ['9100', 'Bilancio di apertura', 'chiusura'],
];
const insAcc = db.prepare('INSERT OR IGNORE INTO accounts (code, name, type) VALUES (?, ?, ?)');
for (const a of ACCOUNTS) insAcc.run(...a);

const DEFAULT_SETTINGS = {
  property: {
    name: 'Affittacamere', address: '', zip: '', city: '', country: 'CH',
    phone: '', email: '', vat_number: '', iban: '', category: 'camere',
  },
  vat: { registered: true, rate_lodging: 3.8, rate_standard: 8.1 },
  tourist_tax: {
    // Ticino, dal 1.1.2025 – categoria "camere, appartamenti e case di vacanza"
    soggiorno_per_night: 2.0, promozione_per_night: 1.25, exempt_under_age: 6,
    otr: '',
  },
  invoice: { prefix: '', next_number: 1, payment_days: 10, footer: 'Grazie per il soggiorno.' },
  checkin_time: '14:00', checkout_time: '10:00',
};
const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
const setSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
  if (!getSetting.get(k)) setSetting.run(k, JSON.stringify(v));
}

function settings() {
  const out = {};
  for (const row of db.prepare('SELECT key, value FROM settings').all()) out[row.key] = JSON.parse(row.value);
  // completa chiavi nuove aggiunte in versioni successive
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    if (typeof v === 'object' && v) out[k] = { ...v, ...(out[k] || {}) };
    else if (out[k] === undefined) out[k] = v;
  }
  return out;
}
function saveSettings(obj) {
  const tx = db.transaction((o) => { for (const [k, v] of Object.entries(o)) setSetting.run(k, JSON.stringify(v)); });
  tx(obj);
}

function inferAccountType(code, name = '') {
  const n = name.toLowerCase();
  if (/ricav|interessi attivi|proventi|ricavi/.test(n)) return 'ricavo';
  const d = String(code)[0];
  if (d === '1') return 'attivo';
  if (d === '2') return 'passivo';
  if (d === '3') return 'ricavo';
  if (d === '9') return 'chiusura';
  return 'costo';
}

module.exports = { db, DB_PATH, settings, saveSettings, inferAccountType };
