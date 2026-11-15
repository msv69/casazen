import { useEffect, useState } from 'react';
import { useApi, useApp, today, addDays, weekday, nights, KeyTag, STATUS_LABEL, monthName } from '../util.jsx';

function useNarrow() {
  const [n, setN] = useState(window.innerWidth < 900);
  useEffect(() => { const h = () => setN(window.innerWidth < 900); window.addEventListener('resize', h); return () => window.removeEventListener('resize', h); }, []);
  return n;
}

export default function Planning() {
  const { openBooking, newBooking, rev } = useApp();
  const narrow = useNarrow();
  const [from, setFrom] = useState(addDays(today(), -1));
  const [days, setDays] = useState(narrow ? 10 : 21);
  const [p] = useApi(`/planning?from=${from}&days=${days}`, [rev]);
  const CW = narrow ? 44 : 52, RW = narrow ? 70 : 170, RH = 46, HH = 50;
  if (!p) return null;
  const dates = Array.from({ length: days }, (_, i) => addDays(from, i));
  const t = today();
  const rowOf = Object.fromEntries(p.rooms.map((r, i) => [r.id, i]));
  const isWe = (d) => ['sab', 'dom'].includes(weekday(d));
  const m0 = new Date(from + 'T00:00:00Z');
  return (
    <>
      <div className="page-head">
        <div><h1>Planning</h1><div className="sub">{monthName(m0.getUTCMonth())} {m0.getUTCFullYear()}. Tocca una casella libera per prenotare.</div></div>
        <div className="row">
          <button className="btn" onClick={() => setFrom(addDays(from, -7))} aria-label="Settimana precedente">‹</button>
          <button className="btn" onClick={() => setFrom(addDays(today(), -1))}>Oggi</button>
          <button className="btn" onClick={() => setFrom(addDays(from, 7))} aria-label="Settimana successiva">›</button>
          <input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} style={{ width: 150 }} className="hide-m" aria-label="Dal giorno" />
          <select value={days} onChange={(e) => setDays(+e.target.value)} style={{ width: 'auto' }} aria-label="Giorni visibili">
            {[7, 10, 14, 21, 31, 45].map((n) => <option key={n} value={n}>{n} giorni</option>)}
          </select>
        </div>
      </div>
      {p.rooms.length === 0 ? <div className="panel empty">Nessuna camera configurata. Aggiungile in Impostazioni → Camere.</div> : (
        <div className="tableau">
          <div className="tb-grid" style={{ gridTemplateColumns: `${RW}px repeat(${days}, ${CW}px)`, gridTemplateRows: `${HH}px repeat(${p.rooms.length}, ${RH}px)` }}>
            <div className="tb-corner" />
            {dates.map((d) => (
              <div key={d} className={'tb-head' + (isWe(d) ? ' we' : '') + (d === t ? ' today' : '')}>{weekday(d)}<b>{+d.slice(8)}</b></div>
            ))}
            {p.rooms.map((r) => [
              <div key={'r' + r.id} className="tb-room"><KeyTag room={r.name} meta={<>{r.type}<br />{r.capacity} posti</>} /></div>,
              ...dates.map((d) => (
                <div key={r.id + d} className={'tb-cell' + (isWe(d) ? ' we' : '')} role="button" tabIndex={-1} aria-label={`Prenota camera ${r.name} dal ${d}`}
                  onClick={() => newBooking({ room_id: r.id, arrival: d, departure: addDays(d, 1), rate_per_night: r.base_rate, adults: Math.min(2, r.capacity) })} />
              )),
            ])}
            {p.bookings.map((b) => {
              const row = rowOf[b.room_id];
              if (row === undefined) return null;
              const start = Math.max(-0.5, nights(from, b.arrival));
              const end = Math.min(days + 0.5, nights(from, b.departure));
              const left = RW + (start + 0.5) * CW + 2;
              const width = Math.max(14, (end - start) * CW - 4);
              return (
                <div key={b.id} className={`bar st-${b.status}`} style={{ '--c': `var(--s-${b.status})`, left, width, top: HH + row * RH }}
                  onClick={() => openBooking(b.id)} title={`${b.last_name || ''} – ${STATUS_LABEL[b.status]} – ${b.channel}`}>
                  {b.last_name || 'Ospite'} <span className="pax">{b.adults + (b.children || 0)}p</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="legend">
        {['opzione', 'confermata', 'checkin', 'checkout'].map((s) => <span key={s} className={`status st-${s}`}>{STATUS_LABEL[s]}</span>)}
      </div>
    </>
  );
}
