import { useState } from 'react';
import { api, useApi, useApp, Field, chf } from '../util.jsx';

function PropertyForm() {
  const { settings, reloadSettings, notify } = useApp();
  const [s, setS] = useState(settings);
  const set = (grp, k, num) => (e) => setS({ ...s, [grp]: { ...s[grp], [k]: e.target.type === 'checkbox' ? e.target.checked : num ? Number(e.target.value) : e.target.value } });
  const save = async (e) => { e.preventDefault(); try { await api('/settings', { method: 'PUT', body: s }); reloadSettings(); notify('Impostazioni salvate'); } catch (x) { notify(x.message, true); } };
  const p = s.property, v = s.vat, t = s.tourist_tax, inv = s.invoice;
  return (
    <form onSubmit={save} className="stack">
      <section className="panel"><h3>Struttura</h3><div className="form">
        <Field label="Nome" wide><input value={p.name} onChange={set('property', 'name')} /></Field>
        <Field label="Indirizzo"><input value={p.address} onChange={set('property', 'address')} /></Field>
        <Field label="NPA"><input value={p.zip} onChange={set('property', 'zip')} /></Field>
        <Field label="Località"><input value={p.city} onChange={set('property', 'city')} /></Field>
        <Field label="Telefono"><input value={p.phone} onChange={set('property', 'phone')} /></Field>
        <Field label="Email"><input value={p.email} onChange={set('property', 'email')} /></Field>
        <Field label="IBAN per la polizza QR"><input value={p.iban} onChange={set('property', 'iban')} placeholder="CH.. o QR-IBAN" /></Field>
        <Field label="Numero IVA (IDI)"><input value={p.vat_number} onChange={set('property', 'vat_number')} placeholder="CHE-123.456.789 IVA" /></Field>
      </div></section>
      <section className="panel"><h3>IVA</h3><div className="form">
        <label className="check wide"><input type="checkbox" checked={v.registered} onChange={set('vat', 'registered')} /> La struttura è iscritta al registro IVA</label>
        <Field label="Aliquota alloggio e colazione %"><input type="number" step="0.1" value={v.rate_lodging} onChange={set('vat', 'rate_lodging', 1)} /></Field>
        <Field label="Aliquota normale %"><input type="number" step="0.1" value={v.rate_standard} onChange={set('vat', 'rate_standard', 1)} /></Field>
      </div></section>
      <section className="panel"><h3>Tassa di soggiorno (Ticino)</h3>
        <p className="muted small">Valori in vigore dal 2025 per camere e appartamenti. Gli alberghi da 1 a 3 stelle pagano CHF 4.20 di soggiorno e 1.25 di promozione. Verifica le esenzioni con la tua OTR.</p>
        <div className="form">
          <Field label="Tassa di soggiorno per notte CHF"><input type="number" step="0.05" value={t.soggiorno_per_night} onChange={set('tourist_tax', 'soggiorno_per_night', 1)} /></Field>
          <Field label="Tassa di promozione per notte CHF"><input type="number" step="0.05" value={t.promozione_per_night} onChange={set('tourist_tax', 'promozione_per_night', 1)} /></Field>
          <Field label="Esenti i bambini sotto i … anni"><input type="number" value={t.exempt_under_age} onChange={set('tourist_tax', 'exempt_under_age', 1)} /></Field>
          <Field label="Organizzazione turistica regionale"><select value={t.otr} onChange={set('tourist_tax', 'otr')}>
            <option value="">–</option>{['OTR Mendrisiotto e Basso Ceresio', 'OTR Lago di Lugano', 'OTR Lago Maggiore e Valli', 'OTR Bellinzonese e Alto Ticino'].map((o) => <option key={o}>{o}</option>)}</select></Field>
        </div></section>
      <section className="panel"><h3>Fatture</h3><div className="form">
        <Field label="Prefisso numero"><input value={inv.prefix} onChange={set('invoice', 'prefix')} placeholder="es. AP-" /></Field>
        <Field label="Prossimo numero"><input type="number" min="1" value={inv.next_number} onChange={set('invoice', 'next_number', 1)} /></Field>
        <Field label="Termine di pagamento (giorni)"><input type="number" value={inv.payment_days} onChange={set('invoice', 'payment_days', 1)} /></Field>
        <Field label="Testo in fondo alla fattura" wide><input value={inv.footer} onChange={set('invoice', 'footer')} /></Field>
      </div></section>
      <div className="row end"><button className="btn primary">Salva impostazioni</button></div>
    </form>
  );
}

function Rooms() {
  const { notify, changed } = useApp();
  const [rooms, reload] = useApi('/rooms');
  const [edit, setEdit] = useState(null);
  const save = async (e) => {
    e.preventDefault();
    try { edit.id ? await api('/rooms/' + edit.id, { method: 'PUT', body: edit }) : await api('/rooms', { body: edit }); setEdit(null); reload(); changed(); notify('Camera salvata'); }
    catch (x) { notify(x.message, true); }
  };
  const del = async (r) => {
    if (!confirm(`Eliminare la camera ${r.name}?`)) return;
    const x = await api('/rooms/' + r.id, { method: 'DELETE' }); reload(); changed(); notify(x.archived ? 'La camera ha prenotazioni: è stata disattivata' : 'Camera eliminata');
  };
  const f = (k, num) => ({ value: edit[k] ?? '', onChange: (e) => setEdit({ ...edit, [k]: num ? Number(e.target.value) : e.target.value }) });
  return (
    <div className="stack">
      <section className="panel">
        <table className="t">
          <thead><tr><th>Camera</th><th>Tipo</th><th className="num">Posti</th><th className="num">Prezzo base</th><th /></tr></thead>
          <tbody>{rooms?.map((r) => (
            <tr key={r.id} className="click" onClick={() => setEdit(r)} style={{ opacity: r.active ? 1 : 0.5 }}>
              <td><span className="keytag"><span className="tag">{r.name}</span></span></td><td>{r.type}{!r.active && ' (disattivata)'}</td>
              <td className="num">{r.capacity}</td><td className="num">{chf(r.base_rate)}</td>
              <td className="num"><button className="btn ghost sm danger" onClick={(e) => { e.stopPropagation(); del(r); }}>Elimina</button></td></tr>))}</tbody>
        </table>
        {rooms?.length === 0 && <div className="empty">Aggiungi la prima camera per iniziare a ricevere prenotazioni.</div>}
      </section>
      {edit ? (
        <form className="panel" onSubmit={save}><h3>{edit.id ? `Camera ${edit.name}` : 'Nuova camera'}</h3><div className="form">
          <Field label="Nome o numero *"><input {...f('name')} required /></Field>
          <Field label="Tipo"><input {...f('type')} placeholder="Doppia, Singola…" /></Field>
          <Field label="Posti letto"><input type="number" min="1" {...f('capacity', 1)} /></Field>
          <Field label="Prezzo base per notte CHF"><input type="number" step="0.05" {...f('base_rate', 1)} /></Field>
          <Field label="Piano"><input {...f('floor')} /></Field>
          <Field label="Ordine nel planning"><input type="number" {...f('sort', 1)} /></Field>
          {edit.id && <label className="check"><input type="checkbox" checked={!!edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Attiva</label>}
          <Field label="Note" wide><input {...f('notes')} /></Field>
        </div><div className="row end" style={{ marginTop: 12 }}><button type="button" className="btn" onClick={() => setEdit(null)}>Annulla</button><button className="btn primary">Salva camera</button></div></form>
      ) : <div><button className="btn primary" onClick={() => setEdit({ capacity: 2, base_rate: 0, active: 1, sort: (rooms?.length || 0) })}>Aggiungi camera</button></div>}
    </div>
  );
}

function Users() {
  const { notify, user } = useApp();
  const [users, reload] = useApi('/users');
  const [n, setN] = useState({ username: '', name: '', password: '', role: 'reception' });
  const add = async (e) => { e.preventDefault(); try { await api('/users', { body: n }); setN({ username: '', name: '', password: '', role: 'reception' }); reload(); notify('Utente creato'); } catch (x) { notify(x.message, true); } };
  return (
    <div className="stack">
      <section className="panel"><table className="t"><tbody>{users?.map((u) => (
        <tr key={u.id}><td><b>{u.name}</b><div className="muted small">{u.username}</div></td><td>{u.role === 'admin' ? 'Amministratore' : 'Reception'}</td>
          <td className="num">{u.id !== user.id && <button className="btn ghost sm danger" onClick={async () => { if (confirm('Eliminare l\'utente?')) { await api('/users/' + u.id, { method: 'DELETE' }); reload(); } }}>Elimina</button>}</td></tr>))}</tbody></table></section>
      <form className="panel" onSubmit={add}><h3>Nuovo utente</h3>
        <p className="muted small">La reception gestisce prenotazioni, ospiti, conti e tassa di soggiorno. Contabilità, importazioni e impostazioni restano all'amministratore.</p>
        <div className="form">
          <Field label="Nome utente"><input value={n.username} onChange={(e) => setN({ ...n, username: e.target.value })} autoComplete="off" /></Field>
          <Field label="Nome visualizzato"><input value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} /></Field>
          <Field label="Password (min. 8 caratteri)"><input type="password" value={n.password} onChange={(e) => setN({ ...n, password: e.target.value })} autoComplete="new-password" /></Field>
          <Field label="Ruolo"><select value={n.role} onChange={(e) => setN({ ...n, role: e.target.value })}><option value="reception">Reception</option><option value="admin">Amministratore</option></select></Field>
        </div><div className="row end" style={{ marginTop: 12 }}><button className="btn primary">Crea utente</button></div></form>
    </div>
  );
}

function Account({ onLogout }) {
  const { notify, user } = useApp();
  const [p, setP] = useState({ current: '', next: '' });
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('theme') || ''; } catch { return ''; } });
  const applyTheme = (t) => { setTheme(t); if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; try { localStorage.setItem('theme', t); } catch {} };
  const save = async (e) => { e.preventDefault(); try { await api('/me/password', { body: p }); setP({ current: '', next: '' }); notify('Password cambiata'); } catch (x) { notify(x.message, true); } };
  return (
    <div className="stack">
      <form className="panel" onSubmit={save}><h3>Cambia password di {user.username}</h3><div className="form">
        <Field label="Password attuale"><input type="password" value={p.current} onChange={(e) => setP({ ...p, current: e.target.value })} autoComplete="current-password" /></Field>
        <Field label="Nuova password"><input type="password" value={p.next} onChange={(e) => setP({ ...p, next: e.target.value })} autoComplete="new-password" /></Field>
        <div style={{ alignSelf: 'end' }}><button className="btn primary">Cambia password</button></div>
      </div></form>
      <section className="panel"><h3>Aspetto</h3>
        <div className="row">{[['', 'Come il dispositivo'], ['light', 'Chiaro'], ['dark', 'Scuro']].map(([k, l]) => <button key={k} className={'btn' + (theme === k ? ' primary' : '')} onClick={() => applyTheme(k)}>{l}</button>)}</div></section>
      <section className="panel"><h3>App sul telefono</h3>
        <p>Apri questo indirizzo con Safari (iPhone) o Chrome (Android) e scegli “Aggiungi alla schermata Home”: l'app si apre a schermo intero come un'app installata.</p></section>
      <div><button className="btn" onClick={onLogout}>Esci</button></div>
    </div>
  );
}

export default function Settings({ onLogout }) {
  const { isAdmin } = useApp();
  const tabs = isAdmin ? [['p', 'Struttura e tasse'], ['r', 'Camere'], ['u', 'Utenti'], ['a', 'Il mio account']] : [['a', 'Il mio account']];
  const [tab, setTab] = useState(tabs[0][0]);
  return (
    <>
      <div className="page-head"><div><h1>Impostazioni</h1></div></div>
      <div className="tabs">{tabs.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'p' && <PropertyForm />}
      {tab === 'r' && <Rooms />}
      {tab === 'u' && <Users />}
      {tab === 'a' && <Account onLogout={onLogout} />}
    </>
  );
}
