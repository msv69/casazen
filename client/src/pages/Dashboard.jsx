import { useApi, useApp, longDate, guestName, KeyTag, chf, weekday, dmy } from '../util.jsx';

function List({ title, rows, empty, action, onOpen }) {
  return (
    <section className="panel">
      <div className="row"><h2 style={{ margin: 0 }}>{title}</h2><span className="muted">{rows.length}</span></div>
      {rows.length === 0 ? <p className="muted" style={{ marginTop: 10 }}>{empty}</p> : (
        <ul className="mini-list">
          {rows.map((b) => (
            <li key={b.id} onClick={() => onOpen(b.id)}>
              <KeyTag room={b.room_name} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{guestName(b)}</div>
                <div className="muted small">{b.adults + (b.children || 0)} pers., fino al {dmy(b.departure)}</div>
              </div>
              {action && action(b)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function Dashboard() {
  const { openBooking, newBooking, rev, isAdmin } = useApp();
  const [d] = useApi('/dashboard', [rev]);
  if (!d) return null;
  const max = Math.max(1, d.rooms);
  return (
    <>
      <div className="page-head">
        <div><h1>{longDate(d.today)}</h1>
          <div className="sub">{d.series[0]?.occupied ?? 0} camere occupate su {d.rooms} stanotte</div></div>
        <button className="btn primary" onClick={() => newBooking()}>Nuova prenotazione</button>
      </div>
      <div className="today-cols">
        <List title="Arrivi" rows={d.arrivals} empty="Nessun arrivo previsto oggi." onOpen={openBooking}
          action={(b) => b.status !== 'checkin' && <span className="btn sm">Check-in</span>} />
        <List title="Partenze" rows={d.departures} empty="Nessuna partenza oggi." onOpen={openBooking}
          action={(b) => b.status === 'checkin' && <span className="btn sm">Check-out</span>} />
        <List title="In casa" rows={d.inhouse} empty="Nessun ospite in casa." onOpen={openBooking} />
      </div>
      <div className="grid g2" style={{ marginTop: 16 }}>
        <section className="panel">
          <h2>Occupazione prossimi 14 giorni</h2>
          <div className="occ" aria-label="Camere occupate per notte">
            {d.series.map((s) => <div key={s.date} className={s.occupied / max < 0.5 ? 'low' : ''} style={{ height: `${(s.occupied / max) * 100}%` }} title={`${dmy(s.date)}: ${s.occupied}/${s.rooms}`} />)}
          </div>
          <div className="occ-l">{d.series.map((s) => <span key={s.date}>{weekday(s.date).slice(0, 1)}</span>)}</div>
          <div className="grid g3 keep" style={{ marginTop: 16 }}>
            <div className="figure"><span className="v">{Math.round(d.occupancy_month * 100)}%</span><span className="l">occupazione del mese</span></div>
            <div className="figure"><span className="v">{d.room_nights_month}</span><span className="l">notti-camera vendute</span></div>
            {isAdmin && <div className="figure"><span className="v">{chf(d.revenue_month)}</span><span className="l">ricavi del mese, CHF netti</span></div>}
          </div>
        </section>
        <section className="panel">
          <h2>Conti da incassare</h2>
          {d.open_balances.length === 0 ? <p className="muted">Tutti gli ospiti partiti hanno saldato.</p> : (
            <table className="t"><tbody>
              {d.open_balances.map((b) => (
                <tr key={b.id} className="click" onClick={() => openBooking(b.id)}>
                  <td>{guestName(b)}<div className="muted small">Partito il {dmy(b.departure)}, camera {b.room_name}</div></td>
                  <td className="num neg">{chf(b.balance)}</td>
                </tr>))}
            </tbody></table>
          )}
          {isAdmin && d.liquidity && (
            <>
              <h3 style={{ marginTop: 18 }}>Liquidità</h3>
              <table className="t"><tbody>
                {d.liquidity.filter((a) => a.saldo !== 0).map((a) => <tr key={a.code}><td>{a.code} {a.name}</td><td className="num">{chf(a.saldo)}</td></tr>)}
              </tbody></table>
            </>
          )}
        </section>
      </div>
    </>
  );
}
