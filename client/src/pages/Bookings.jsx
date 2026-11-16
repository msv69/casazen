import { useState } from 'react';
import { useApi, useApp, Status, chf, dmy, guestName, STATUS_LABEL, KeyTag } from '../util.jsx';

export default function Bookings() {
  const { openBooking, newBooking, rev } = useApp();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const qs = new URLSearchParams({ ...(q && { q }), ...(status && { status }), ...(from && { from }) }).toString();
  const [rows] = useApi('/bookings?' + qs, [rev]);
  return (
    <>
      <div className="page-head">
        <div><h1>Prenotazioni</h1><div className="sub">Le più recenti per data di arrivo.</div></div>
        <button className="btn primary" onClick={() => newBooking()}>Nuova prenotazione</button>
      </div>
      <div className="row" style={{ marginBottom: 14 }}>
        <input placeholder="Cerca per cognome o codice" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 280 }} aria-label="Cerca" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 'auto' }} aria-label="Stato">
          <option value="">Tutti gli stati</option>{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label className="row small muted">In casa dopo il<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 160 }} /></label>
      </div>
      <section className="panel">
        {!rows ? null : rows.length === 0 ? <div className="empty">Nessuna prenotazione trovata. Creane una dal planning o con “Nuova prenotazione”.</div> : (
          <div className="tablewrap"><table className="t">
            <thead><tr><th>Camera</th><th>Ospite</th><th>Soggiorno</th><th className="hide-m">Canale</th><th>Stato</th><th className="num hide-m">Pagato</th><th className="hide-m">Fattura</th></tr></thead>
            <tbody>{rows.map((b) => (
              <tr key={b.id} className="click" onClick={() => openBooking(b.id)}>
                <td><KeyTag room={b.room_name} /></td>
                <td><b>{guestName(b)}</b><div className="muted small">{b.code}</div></td>
                <td>{dmy(b.arrival)} – {dmy(b.departure)}<div className="muted small">{b.nights} notti, {b.adults + b.children} pers.</div></td>
                <td className="hide-m">{b.channel}</td>
                <td><Status s={b.status} /></td>
                <td className="num hide-m">{chf(b.paid)}</td>
                <td className="hide-m">{b.invoice_number || <span className="muted">–</span>}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
