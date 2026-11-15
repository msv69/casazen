// Dati dimostrativi: `npm run seed` (solo se il database non ha ancora camere)
const { db, saveSettings, settings } = require('./db');
const L = require('./lib');

if (db.prepare('SELECT COUNT(*) n FROM rooms').get().n > 0 && !process.argv.includes('--force')) {
  console.log('Il database contiene già delle camere: niente da fare (usa --force per aggiungere comunque i dati demo).');
  process.exit(0);
}
const s = settings();
saveSettings({ property: { ...s.property, name: 'Affittacamere Al Ponte', address: 'Via Bossi 12', zip: '6830', city: 'Chiasso', phone: '+41 91 000 00 00', email: 'info@example.ch', iban: 'CH93 0076 2011 6238 5295 7', vat_number: 'CHE-123.456.789 IVA' } });

const rooms = [['1', 'Doppia', 2, 120], ['2', 'Doppia', 2, 120], ['3', 'Matrimoniale vista lago', 2, 145], ['4', 'Tripla', 3, 165], ['5', 'Singola', 1, 85], ['6', 'Family', 4, 190]];
const roomIds = rooms.map((r, i) => db.prepare('INSERT INTO rooms (name, type, capacity, base_rate, sort) VALUES (?, ?, ?, ?, ?)').run(...r, i).lastInsertRowid);

const people = [
  ['Laura', 'Bernasconi', 'CH', 'Lugano', '6900'], ['Marco', 'Rossi', 'IT', 'Como', '22100'], ['Anna', 'Keller', 'CH', 'Zürich', '8001'],
  ['Thomas', 'Müller', 'DE', 'München', '80331'], ['Giulia', 'Ferrari', 'IT', 'Milano', '20121'], ['Sophie', 'Dubois', 'FR', 'Lyon', '69001'],
  ['Luca', 'Bianchi', 'CH', 'Bellinzona', '6500'], ['Emma', 'Schneider', 'CH', 'Basel', '4051'], ['Paolo', 'Conti', 'IT', 'Varese', '21100'],
];
const gIds = people.map(([fn, ln, c, city, zip]) => db.prepare('INSERT INTO guests (first_name, last_name, nationality, country, city, zip, address, email) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  .run(fn, ln, c, c, city, zip, 'Via Centrale 1', `${fn.toLowerCase()}@example.com`).lastInsertRowid);

const today = new Date().toISOString().slice(0, 10);
const plan = [
  [0, 0, -3, 2, 'checkin', 'Diretto', 2, 0], [1, 1, -1, 3, 'checkin', 'Booking.com', 2, 0], [2, 2, 0, 4, 'confermata', 'Diretto', 2, 0],
  [3, 3, 1, 5, 'confermata', 'Airbnb', 2, 1], [4, 4, -6, -2, 'checkout', 'Telefono', 1, 0], [5, 5, 3, 10, 'confermata', 'Booking.com', 2, 2],
  [0, 6, 4, 7, 'opzione', 'Email', 2, 0], [2, 7, 6, 9, 'confermata', 'Diretto', 2, 0], [1, 8, 5, 8, 'confermata', 'Booking.com', 2, 0],
  [4, 2, 2, 3, 'confermata', 'Diretto', 1, 0],
];
for (const [ri, gi, a, d, status, channel, adults, children] of plan) {
  const id = db.prepare(`INSERT INTO bookings (code, room_id, guest_id, arrival, departure, adults, children, status, channel, rate_per_night, breakfast, breakfast_price)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 15)`).run(L.nextBookingCode(), roomIds[ri], gIds[gi], L.addDays(today, a), L.addDays(today, d), adults, children, status, channel, rooms[ri][3]).lastInsertRowid;
  db.prepare('INSERT INTO booking_guests (booking_id, guest_id) VALUES (?, ?)').run(id, gIds[gi]);
  if (status === 'checkout') {
    const inv = L.createInvoice(id, L.addDays(today, d));
    const f = L.computeFolio(id);
    const pid = db.prepare('INSERT INTO payments (booking_id, date, amount, method) VALUES (?, ?, ?, ?)').run(id, L.addDays(today, d), f.total, 'carta').lastInsertRowid;
    L.postPayment(pid);
    console.log('Fattura demo', inv.number);
  }
  if (status === 'checkin' && ri === 0) {
    const pid = db.prepare('INSERT INTO payments (booking_id, date, amount, method, note) VALUES (?, ?, ?, ?, ?)').run(id, L.addDays(today, a), 100, 'twint', 'Acconto').lastInsertRowid;
    L.postPayment(pid);
  }
}
// qualche spesa
const m = today.slice(0, 8);
L.post({ date: m + '01', doc_no: 'F-221', doc_type: 'FATP', description: 'Lavanderia biancheria', debit_account: '6200', credit_account: '1020', amount: 640 });
L.post({ date: m + '02', doc_no: 'AIL-11', doc_type: 'FATP', description: 'AIL energia elettrica', debit_account: '6400', credit_account: '1020', amount: 385.4 });
L.post({ date: m + '03', doc_no: 'S-03', doc_type: 'CONT', description: 'Spesa colazioni', debit_account: '4000', credit_account: '1000', amount: 212.6 });
console.log('Dati demo inseriti.');
