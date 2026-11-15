import { useApi, useApp, chf, dmy, guestName } from '../util.jsx';

export default function Invoices() {
  const { openBooking, rev } = useApp();
  const [rows] = useApi('/invoices', [rev]);
  const open = rows?.filter((r) => r.total - r.paid > 0.04) || [];
  return (
    <>
      <div className="page-head">
        <div><h1>Fatture e incassi</h1>
          <div className="sub">{open.length ? `${open.length} fatture da incassare, CHF ${chf(open.reduce((a, r) => a + r.total - r.paid, 0))}` : 'Tutte le fatture sono saldate.'}</div></div>
      </div>
      <section className="panel">
        {rows && rows.length === 0 ? <div className="empty">Nessuna fattura emessa. Le fatture si creano dal conto della prenotazione o al check-out.</div> : (
          <div className="tablewrap"><table className="t">
            <thead><tr><th>Numero</th><th>Data</th><th>Ospite</th><th className="num">Totale</th><th className="num">Saldo</th><th /></tr></thead>
            <tbody>{rows?.map((r) => {
              const bal = r.total - r.paid;
              return (
                <tr key={r.id} className="click" onClick={() => openBooking(r.booking_id)}>
                  <td><b>{r.number}</b></td><td>{dmy(r.date)}</td><td>{guestName(r)}<div className="muted small">{r.code}</div></td>
                  <td className="num">{chf(r.total)}</td>
                  <td className={'num' + (bal > 0.04 ? ' neg' : '')}>{bal > 0.04 ? chf(bal) : 'saldata'}</td>
                  <td><a className="btn sm" href={`/api/invoices/${r.id}/print`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Stampa</a></td>
                </tr>);
            })}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
