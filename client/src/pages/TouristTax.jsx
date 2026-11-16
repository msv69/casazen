import { useState } from 'react';
import { api, useApi, useApp, chf, dmy, today, monthStart, nextMonth, prevMonth, monthName, download } from '../util.jsx';

function MonthPicker({ from, setFrom }) {
  const d = new Date(from + 'T00:00:00Z');
  return (
    <div className="row">
      <button className="btn" onClick={() => setFrom(prevMonth(from))} aria-label="Mese precedente">‹</button>
      <b style={{ minWidth: 130, textAlign: 'center' }}>{monthName(d.getUTCMonth())} {d.getUTCFullYear()}</b>
      <button className="btn" onClick={() => setFrom(nextMonth(from))} aria-label="Mese successivo">›</button>
    </div>
  );
}

export default function TouristTax() {
  const { isAdmin, notify, settings } = useApp();
  const [from, setFrom] = useState(monthStart(prevMonth(today())));
  const [tab, setTab] = useState('tassa');
  const to = nextMonth(from);
  const [r] = useApi(`/reports/tourist-tax?from=${from}&to=${to}`);
  const [reg] = useApi(tab === 'registro' ? `/reports/guest-register?from=${from}&to=${to}` : null);
  const postPromo = async () => {
    try { const x = await api('/reports/tourist-tax/post', { body: { from, to } }); notify(`Registrata tassa di promozione CHF ${chf(x.amount)} (6700 a 2210)`); } catch (e) { notify(e.message, true); }
  };
  const deadline = `5.${String(new Date(to + 'T00:00:00Z').getUTCMonth() + 1).padStart(2, '0')}.${to.slice(0, 4)}`;
  return (
    <>
      <div className="page-head">
        <div><h1>Tassa di soggiorno e notifiche</h1>
          <div className="sub">Pernottamenti da notificare alla {settings.tourist_tax.otr || 'Organizzazione turistica regionale'} entro il {deadline}.</div></div>
        <MonthPicker from={from} setFrom={setFrom} />
      </div>
      <div className="tabs">
        <button className={tab === 'tassa' ? 'on' : ''} onClick={() => setTab('tassa')}>Pernottamenti e tasse</button>
        <button className={tab === 'registro' ? 'on' : ''} onClick={() => setTab('registro')}>Registro ospiti</button>
      </div>
      {tab === 'tassa' && r && (
        <div className="stack">
          <section className="panel">
            <div className="grid g4 keep">
              <div className="figure"><span className="v">{r.taxable_nights}</span><span className="l">pernottamenti imponibili</span></div>
              <div className="figure"><span className="v">{r.exempt_nights}</span><span className="l">esenti (bambini sotto i {r.rates.exempt_under_age} anni)</span></div>
              <div className="figure"><span className="v">{chf(r.soggiorno)}</span><span className="l">tassa di soggiorno, CHF {chf(r.rates.soggiorno)} a notte, incassata dagli ospiti</span></div>
              <div className="figure"><span className="v">{chf(r.promozione)}</span><span className="l">tassa di promozione, CHF {chf(r.rates.promozione)} a notte, a carico della struttura</span></div>
            </div>
            <div className="row" style={{ marginTop: 16 }}>
              <b>Totale da versare CHF {chf(r.total)}</b><div className="spacer" />
              <button className="btn" onClick={() => download(`/reports/tourist-tax?from=${from}&to=${to}&format=csv`)}>Scarica CSV</button>
              <button className="btn" onClick={() => print()}>Stampa</button>
              {isAdmin && r.promozione > 0 && <button className="btn" onClick={postPromo}>Registra la tassa di promozione</button>}
            </div>
          </section>
          <section className="panel">
            {r.detail.length === 0 ? <div className="empty">Nessun pernottamento in questo mese.</div> : (
              <div className="tablewrap"><table className="t">
                <thead><tr><th>Ospite</th><th className="hide-m">Provenienza</th><th>Camera</th><th>Soggiorno</th><th className="num">Notti</th><th className="num">Imponibili</th><th className="num">Esenti</th></tr></thead>
                <tbody>{r.detail.map((d) => (
                  <tr key={d.code}><td>{d.guest}<div className="muted small">{d.code}</div></td><td className="hide-m">{d.country}</td><td>{d.room}</td>
                    <td>{dmy(d.arrival)} – {dmy(d.departure)}</td><td className="num">{d.nights}</td><td className="num">{d.taxable_nights}</td><td className="num">{d.exempt_nights}</td></tr>))}</tbody>
                <tfoot><tr><td colSpan="5">Totale</td><td className="num">{r.taxable_nights}</td><td className="num">{r.exempt_nights}</td></tr></tfoot>
              </table></div>
            )}
          </section>
        </div>
      )}
      {tab === 'registro' && reg && (
        <section className="panel">
          <div className="row" style={{ marginBottom: 12 }}>
            <span className="muted">Ospiti arrivati nel mese, con i dati richiesti per la notifica di alloggio.</span><div className="spacer" />
            <button className="btn" onClick={() => download(`/reports/guest-register?from=${from}&to=${to}&format=csv`)}>Scarica CSV</button>
            <button className="btn" onClick={() => print()}>Stampa</button>
          </div>
          {reg.rows.length === 0 ? <div className="empty">Nessun arrivo in questo mese.</div> : (
            <div className="tablewrap"><table className="t">
              <thead><tr><th>Arrivo</th><th>Ospite</th><th>Nato il</th><th>Nazionalità</th><th>Documento</th><th className="hide-m">Residenza</th><th>Camera</th></tr></thead>
              <tbody>{reg.rows.map((g, i) => {
                const missing = !g.birth_date || !g.nationality || !g.doc_number;
                return (
                  <tr key={i}><td>{dmy(g.arrival)}</td><td><b>{g.last_name}</b> {g.first_name}{missing && <div className="small neg">Dati incompleti</div>}</td>
                    <td>{dmy(g.birth_date)}</td><td>{g.nationality}</td><td>{g.doc_type} {g.doc_number}</td>
                    <td className="hide-m">{[g.zip, g.city, g.country].filter(Boolean).join(' ')}</td><td>{g.room}</td></tr>);
              })}</tbody>
            </table></div>
          )}
        </section>
      )}
    </>
  );
}
