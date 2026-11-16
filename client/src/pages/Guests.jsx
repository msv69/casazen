import { useState } from 'react';
import { api, useApi, useApp, Modal, Field, dmy, guestName, Status } from '../util.jsx';

const FIELDS = [
  ['last_name', 'Cognome *'], ['first_name', 'Nome'], ['birth_date', 'Data di nascita', 'date'], ['nationality', 'Nazionalità'],
  ['phone', 'Telefono', 'tel'], ['email', 'Email', 'email'], ['address', 'Indirizzo'], ['zip', 'NPA'], ['city', 'Località'], ['country', 'Paese'],
  ['doc_type', 'Documento'], ['doc_number', 'Numero documento'], ['doc_issuer', 'Rilasciato da'], ['doc_expiry', 'Scadenza documento', 'date'],
];

function GuestEditor({ id, onClose }) {
  const { notify, openBooking, changed } = useApp();
  const [g, setG] = useState(null);
  const [loaded] = useApi(id ? '/guests/' + id : null);
  const cur = g || loaded || (id ? null : {});
  if (!cur) return null;
  const save = async (e) => {
    e.preventDefault();
    try { id ? await api('/guests/' + id, { method: 'PUT', body: cur }) : await api('/guests', { body: cur }); notify('Ospite salvato'); changed(); onClose(); }
    catch (x) { notify(x.message, true); }
  };
  const del = async () => {
    if (!confirm('Eliminare questo ospite?')) return;
    try { await api('/guests/' + id, { method: 'DELETE' }); notify('Ospite eliminato'); changed(); onClose(); } catch (x) { notify(x.message, true); }
  };
  return (
    <Modal title={id ? guestName(cur) : 'Nuovo ospite'} onClose={onClose} narrow>
      <form onSubmit={save} className="stack">
        <div className="form">
          {FIELDS.map(([k, l, t]) => <Field key={k} label={l}><input type={t || 'text'} value={cur[k] || ''} onChange={(e) => setG({ ...cur, [k]: e.target.value })} /></Field>)}
          <Field label="Note" wide><textarea rows="3" value={cur.notes || ''} onChange={(e) => setG({ ...cur, notes: e.target.value })} /></Field>
        </div>
        <div className="row">{id && <button type="button" className="btn ghost danger" onClick={del}>Elimina</button>}<div className="spacer" /><button className="btn primary">Salva ospite</button></div>
      </form>
      {loaded?.bookings?.length > 0 && (
        <section className="panel" style={{ marginTop: 20 }}>
          <h3>Soggiorni</h3>
          <table className="t"><tbody>{loaded.bookings.map((b) => (
            <tr key={b.id} className="click" onClick={() => { onClose(); openBooking(b.id); }}><td>{dmy(b.arrival)} – {dmy(b.departure)}</td><td>Camera {b.room_name}</td><td><Status s={b.status} /></td></tr>
          ))}</tbody></table>
        </section>
      )}
    </Modal>
  );
}

export default function Guests() {
  const { rev } = useApp();
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null);
  const [rows] = useApi('/guests?q=' + encodeURIComponent(q), [rev]);
  return (
    <>
      <div className="page-head">
        <div><h1>Ospiti</h1><div className="sub">Anagrafica con documenti e storico dei soggiorni.</div></div>
        <button className="btn primary" onClick={() => setEdit({ id: null })}>Nuovo ospite</button>
      </div>
      <input placeholder="Cerca per nome, email o telefono" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320, marginBottom: 14 }} aria-label="Cerca ospite" />
      <section className="panel">
        {rows && rows.length === 0 ? <div className="empty">Nessun ospite trovato.</div> : (
          <div className="tablewrap"><table className="t">
            <thead><tr><th>Ospite</th><th className="hide-m">Contatti</th><th>Provenienza</th><th className="num">Soggiorni</th><th className="hide-m">Ultimo arrivo</th></tr></thead>
            <tbody>{rows?.map((g) => (
              <tr key={g.id} className="click" onClick={() => setEdit({ id: g.id })}>
                <td><b>{guestName(g)}</b>{!g.doc_number && <div className="muted small">Documento mancante</div>}</td>
                <td className="hide-m">{g.phone}<div className="muted small">{g.email}</div></td>
                <td>{[g.city, g.country].filter(Boolean).join(', ')}</td>
                <td className="num">{g.stays}</td>
                <td className="hide-m">{dmy(g.last_stay)}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </section>
      {edit && <GuestEditor id={edit.id} onClose={() => setEdit(null)} />}
    </>
  );
}
