import { useEffect, useState } from 'react';
import { api, useApi, useApp, Modal, Field, KeyTag, Status, chf, dmy, nights, addDays, today, guestName, CHANNELS, METHODS, STATUS_LABEL } from '../util.jsx';

function GuestPicker({ value, onChange }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState([]);
  useEffect(() => {
    if (q.length < 2) return setRes([]);
    const t = setTimeout(() => api('/guests?q=' + encodeURIComponent(q)).then((r) => setRes(r.slice(0, 6))), 200);
    return () => clearTimeout(t);
  }, [q]);
  if (value?.id) {
    return (
      <div className="row panel" style={{ padding: 10 }}>
        <div><b>{guestName(value)}</b><div className="muted small">{[value.phone, value.email, value.city].filter(Boolean).join(', ')}</div></div>
        <div className="spacer" /><button type="button" className="btn sm" onClick={() => onChange({})}>Cambia ospite</button>
      </div>
    );
  }
  const g = value || {};
  const set = (k) => (e) => onChange({ ...g, [k]: e.target.value });
  return (
    <div className="stack">
      <Field label="Cerca un ospite già registrato"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cognome, email o telefono" /></Field>
      {res.length > 0 && (
        <ul className="mini-list panel" style={{ padding: '0 10px' }}>
          {res.map((r) => <li key={r.id} onClick={() => { onChange(r); setQ(''); }}><b>{guestName(r)}</b><span className="muted small">{r.city} {r.stays ? `, ${r.stays} soggiorni` : ''}</span></li>)}
        </ul>
      )}
      <div className="form">
        <Field label="Cognome *"><input value={g.last_name || ''} onChange={set('last_name')} /></Field>
        <Field label="Nome"><input value={g.first_name || ''} onChange={set('first_name')} /></Field>
        <Field label="Telefono"><input type="tel" value={g.phone || ''} onChange={set('phone')} /></Field>
        <Field label="Email"><input type="email" value={g.email || ''} onChange={set('email')} /></Field>
      </div>
    </div>
  );
}

function BookingForm({ initial, onSaved, onCancel }) {
  const { settings, notify, changed } = useApp();
  const [rooms] = useApi('/rooms');
  const [b, setB] = useState({ adults: 2, children: 0, status: 'confermata', channel: 'Diretto', breakfast: false, breakfast_price: 15, arrival: today(), departure: addDays(today(), 1), ...initial });
  const [guest, setGuest] = useState(initial.guest || {});
  const [busy, setBusy] = useState(false);
  const set = (k, num) => (e) => setB({ ...b, [k]: e.target.type === 'checkbox' ? e.target.checked : num ? Number(e.target.value) : e.target.value });
  const n = b.arrival && b.departure ? nights(b.arrival, b.departure) : 0;
  const tax = (settings.tourist_tax.soggiorno_per_night || 0) * n * (b.adults || 0);
  const est = n * (b.rate_per_night || 0) + (b.breakfast ? n * ((b.adults || 0) + (b.children || 0)) * (b.breakfast_price || 0) : 0) + tax;
  const pickRoom = (e) => {
    const r = rooms.find((x) => x.id === Number(e.target.value));
    setB({ ...b, room_id: r?.id, rate_per_night: b.rate_per_night || r?.base_rate || 0 });
  };
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const body = { ...b, guest_id: guest.id || null, guest: guest.id ? undefined : guest };
      if (!guest.id && !guest.last_name) throw new Error('Inserisci almeno il cognome dell\'ospite');
      const r = b.id ? await api('/bookings/' + b.id, { method: 'PUT', body }) : await api('/bookings', { body });
      notify(b.id ? 'Prenotazione aggiornata' : 'Prenotazione creata'); changed();
      onSaved(b.id || r.id);
    } catch (x) { notify(x.message, true); } finally { setBusy(false); }
  };
  const room = rooms?.find((r) => r.id === b.room_id);
  return (
    <form onSubmit={save} className="stack">
      <section className="panel stack">
        <h3>Ospite</h3>
        <GuestPicker value={guest} onChange={setGuest} />
      </section>
      <section className="panel">
        <h3>Soggiorno</h3>
        <div className="form">
          <Field label="Camera *">
            <select value={b.room_id || ''} onChange={pickRoom} required>
              <option value="">Scegli…</option>
              {rooms?.filter((r) => r.active || r.id === b.room_id).map((r) => <option key={r.id} value={r.id}>{r.name} – {r.type} ({r.capacity} posti)</option>)}
            </select>
          </Field>
          <Field label="Arrivo *"><input type="date" value={b.arrival} onChange={(e) => setB({ ...b, arrival: e.target.value, departure: b.departure <= e.target.value ? addDays(e.target.value, 1) : b.departure })} required /></Field>
          <Field label="Partenza *"><input type="date" value={b.departure} min={addDays(b.arrival, 1)} onChange={set('departure')} required /></Field>
          <Field label="Adulti"><input type="number" min="1" value={b.adults} onChange={set('adults', 1)} /></Field>
          <Field label={`Bambini sotto i ${settings.tourist_tax.exempt_under_age} anni`}><input type="number" min="0" value={b.children} onChange={set('children', 1)} /></Field>
          <Field label="Prezzo per notte (CHF)"><input type="number" step="0.05" min="0" value={b.rate_per_night ?? ''} onChange={set('rate_per_night', 1)} /></Field>
          <Field label="Canale"><select value={b.channel} onChange={set('channel')}>{CHANNELS.map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Stato"><select value={b.status} onChange={set('status')}>{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <label className="check" style={{ alignSelf: 'end', paddingBottom: 8 }}><input type="checkbox" checked={!!b.breakfast} onChange={set('breakfast')} /> Colazione</label>
          {b.breakfast && <Field label="Colazione per persona (CHF)"><input type="number" step="0.05" value={b.breakfast_price} onChange={set('breakfast_price', 1)} /></Field>}
          <Field label="Note" wide><textarea rows="2" value={b.notes || ''} onChange={set('notes')} /></Field>
        </div>
        {room && b.adults + b.children > room.capacity && <div className="alert" style={{ marginTop: 12 }}>La camera {room.name} ha {room.capacity} posti, la prenotazione ne prevede {b.adults + b.children}.</div>}
        <p className="muted" style={{ marginTop: 12 }}>{n} {n === 1 ? 'notte' : 'notti'}. Totale stimato CHF {chf(est)}, di cui tassa di soggiorno {chf(tax)}.</p>
      </section>
      <div className="row end">
        {onCancel && <button type="button" className="btn" onClick={onCancel}>Annulla</button>}
        <button className="btn primary" disabled={busy}>{b.id ? 'Salva modifiche' : 'Crea prenotazione'}</button>
      </div>
    </form>
  );
}

const DOCS = ['Carta d\'identità', 'Passaporto', 'Permesso di soggiorno', 'Patente'];
function GuestFields({ g, set, compact }) {
  const f = (k) => ({ value: g[k] || '', onChange: (e) => set({ ...g, [k]: e.target.value }) });
  return (
    <div className="form">
      <Field label="Cognome *"><input {...f('last_name')} /></Field>
      <Field label="Nome"><input {...f('first_name')} /></Field>
      <Field label="Data di nascita"><input type="date" {...f('birth_date')} /></Field>
      <Field label="Sesso"><select {...f('gender')}><option value="">–</option><option value="F">F</option><option value="M">M</option><option value="X">Altro</option></select></Field>
      <Field label="Nazionalità"><input {...f('nationality')} placeholder="CH, IT, DE…" maxLength={40} /></Field>
      {!compact && <>
        <Field label="Indirizzo"><input {...f('address')} /></Field>
        <Field label="NPA"><input {...f('zip')} /></Field>
        <Field label="Località"><input {...f('city')} /></Field>
        <Field label="Paese"><input {...f('country')} placeholder="CH" /></Field>
      </>}
      <Field label="Documento"><select {...f('doc_type')}><option value="">–</option>{DOCS.map((d) => <option key={d}>{d}</option>)}</select></Field>
      <Field label="Numero documento"><input {...f('doc_number')} /></Field>
      {!compact && <Field label="Rilasciato da"><input {...f('doc_issuer')} /></Field>}
      {!compact && <Field label="Scadenza"><input type="date" {...f('doc_expiry')} /></Field>}
    </div>
  );
}

function GuestsTab({ data, reload }) {
  const { notify, changed } = useApp();
  const [main, setMain] = useState(data.guest || { last_name: '' });
  const total = data.booking.adults + (data.booking.children || 0);
  const [comp, setComp] = useState(() => {
    const c = [...data.companions];
    while (c.length < total - 1) c.push({});
    return c;
  });
  const save = async (asCheckin) => {
    try {
      if (!main.last_name) throw new Error('Il cognome dell\'ospite principale è obbligatorio');
      await api(`/bookings/${data.booking.id}/checkin`, { body: { guest: main, companions: comp.filter((c) => c.last_name), checkin: asCheckin } });
      notify(asCheckin ? 'Check-in registrato' : 'Dati ospiti salvati'); changed(); reload();
    } catch (x) { notify(x.message, true); }
  };
  return (
    <div className="stack">
      <p className="muted">Per la notifica degli ospiti servono cognome, nome, data di nascita, nazionalità e documento di ogni persona.</p>
      <section className="panel"><h3>Ospite principale</h3><GuestFields g={main} set={setMain} /></section>
      {comp.map((c, i) => (
        <section className="panel" key={i}>
          <div className="row"><h3 style={{ margin: 0 }}>Accompagnatore {i + 1}</h3><div className="spacer" />
            <button className="btn ghost sm" onClick={() => setComp(comp.filter((_, j) => j !== i))}>Rimuovi</button></div>
          <div style={{ marginTop: 10 }}><GuestFields g={c} compact set={(v) => setComp(comp.map((x, j) => (j === i ? v : x)))} /></div>
        </section>
      ))}
      <div className="row">
        <button className="btn" onClick={() => setComp([...comp, {}])}>Aggiungi accompagnatore</button>
        <div className="spacer" />
        {['opzione', 'confermata'].includes(data.booking.status) ? <button className="btn primary" onClick={() => save(true)}>Registra check-in</button>
          : <button className="btn primary" onClick={() => save(false)}>Salva dati ospiti</button>}
      </div>
    </div>
  );
}

function FolioTab({ data, reload, checkout }) {
  const { notify, changed, settings, isAdmin } = useApp();
  const [item, setItem] = useState({ description: '', qty: 1, unit_price: '', vat_rate: settings.vat.rate_standard, account_code: '3420' });
  const [pay, setPay] = useState({ amount: data.balance > 0 ? data.balance : '', method: 'carta', date: today(), note: '' });
  useEffect(() => setPay((p) => ({ ...p, amount: data.balance > 0 ? data.balance : '' })), [data.balance]);
  const run = async (fn, msg) => { try { await fn(); msg && notify(msg); changed(); reload(); } catch (x) { notify(x.message, true); } };
  const locked = !!data.invoice;
  const doCheckout = () => run(() => api(`/bookings/${data.booking.id}/checkout`, { body: { invoice: true, payment: Number(pay.amount) > 0 ? pay : null } }), 'Check-out completato, fattura emessa');
  return (
    <div className="stack">
      {checkout && <div className="alert">Check-out di {guestName(data.booking)}: controlla il conto, registra il pagamento ed emetti la fattura.</div>}
      <section className="panel">
        <div className="tablewrap"><table className="t">
          <thead><tr><th>Voce</th><th className="num">Qtà</th><th className="num">Prezzo</th>{settings.vat.registered && <th className="num hide-m">IVA</th>}<th className="num">CHF</th><th /></tr></thead>
          <tbody>
            {data.lines.map((l, i) => (
              <tr key={i}><td>{l.description}</td><td className="num">{l.qty}</td><td className="num">{chf(l.unit_price)}</td>
                {settings.vat.registered && <td className="num hide-m muted">{l.vat_rate ? l.vat_rate + '%' : '–'}</td>}
                <td className="num">{chf(l.total)}</td>
                <td>{!l.auto && !locked && <button className="btn ghost sm" aria-label="Elimina voce" onClick={() => run(() => api('/items/' + l.id, { method: 'DELETE' }))}>✕</button>}</td></tr>
            ))}
            {data.lines.length === 0 && <tr><td colSpan="6" className="muted">Il conto è vuoto. Indica un prezzo per notte nella prenotazione.</td></tr>}
          </tbody>
          <tfoot>
            {data.vat.map((v) => <tr key={v.rate}><td colSpan={settings.vat.registered ? 4 : 3} className="muted" style={{ fontWeight: 400 }}>di cui IVA {v.rate}%</td><td className="num" style={{ fontWeight: 400 }}>{chf(v.vat)}</td><td /></tr>)}
            <tr><td colSpan={settings.vat.registered ? 4 : 3}>Totale</td><td className="num">{chf(data.total)}</td><td /></tr>
            <tr><td colSpan={settings.vat.registered ? 4 : 3} style={{ fontWeight: 400 }}>Pagato</td><td className="num" style={{ fontWeight: 400 }}>{chf(data.paid)}</td><td /></tr>
            <tr><td colSpan={settings.vat.registered ? 4 : 3}>Saldo</td><td className={'num' + (data.balance > 0.04 ? ' neg' : '')}>{chf(data.balance)}</td><td /></tr>
          </tfoot>
        </table></div>
      </section>
      {!locked && (
        <section className="panel">
          <h3>Aggiungi una voce</h3>
          <form className="form" onSubmit={(e) => { e.preventDefault(); run(() => api(`/bookings/${data.booking.id}/items`, { body: item }), 'Voce aggiunta').then(() => setItem({ ...item, description: '', unit_price: '', qty: 1 })); }}>
            <Field label="Descrizione" wide><input value={item.description} onChange={(e) => setItem({ ...item, description: e.target.value })} placeholder="Minibar, parcheggio, lavanderia…" list="extras" /></Field>
            <datalist id="extras">{['Minibar', 'Parcheggio', 'Lavanderia', 'Animale domestico', 'Letto aggiuntivo', 'Pulizia finale'].map((x) => <option key={x} value={x} />)}</datalist>
            <Field label="Quantità"><input type="number" step="any" value={item.qty} onChange={(e) => setItem({ ...item, qty: e.target.value })} /></Field>
            <Field label="Prezzo CHF"><input type="number" step="0.05" value={item.unit_price} onChange={(e) => setItem({ ...item, unit_price: e.target.value })} required /></Field>
            {settings.vat.registered && <Field label="Aliquota IVA"><select value={item.vat_rate} onChange={(e) => setItem({ ...item, vat_rate: +e.target.value, account_code: +e.target.value === settings.vat.rate_lodging ? '3400' : '3420' })}>
              <option value={settings.vat.rate_standard}>{settings.vat.rate_standard}% normale</option><option value={settings.vat.rate_lodging}>{settings.vat.rate_lodging}% alloggio</option><option value={2.6}>2.6% ridotta</option><option value={0}>esente</option></select></Field>}
            <div style={{ alignSelf: 'end' }}><button className="btn">Aggiungi</button></div>
          </form>
        </section>
      )}
      <section className="panel">
        <h3>Pagamenti</h3>
        {data.payments.length > 0 && <table className="t" style={{ marginBottom: 12 }}><tbody>
          {data.payments.map((p) => <tr key={p.id}><td>{dmy(p.date)}</td><td>{METHODS[p.method]}{p.note ? `, ${p.note}` : ''}</td><td className="num">{chf(p.amount)}</td>
            <td style={{ width: 40 }}><button className="btn ghost sm" aria-label="Elimina pagamento" onClick={() => confirm('Eliminare questo pagamento e la sua registrazione contabile?') && run(() => api('/payments/' + p.id, { method: 'DELETE' }), 'Pagamento eliminato')}>✕</button></td></tr>)}
        </tbody></table>}
        <form className="form" onSubmit={(e) => { e.preventDefault(); run(() => api(`/bookings/${data.booking.id}/payments`, { body: pay }), 'Pagamento registrato'); }}>
          <Field label="Importo CHF"><input type="number" step="0.05" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></Field>
          <Field label="Metodo"><select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Data"><input type="date" value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} /></Field>
          <Field label="Nota"><input value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} placeholder="Acconto, caparra…" /></Field>
          {!checkout && <div style={{ alignSelf: 'end' }}><button className="btn">Registra pagamento</button></div>}
        </form>
      </section>
      <section className="panel">
        <h3>Fattura</h3>
        {data.invoice ? (
          <div className="row">
            <span>Fattura <b>{data.invoice.number}</b> del {dmy(data.invoice.date)}, CHF {chf(data.invoice.total)}</span><div className="spacer" />
            <a className="btn" href={`/api/invoices/${data.invoice.id}/print`} target="_blank" rel="noreferrer">Apri e stampa</a>
            {isAdmin && <button className="btn danger" onClick={() => confirm('Annullare la fattura? Le registrazioni contabili collegate verranno rimosse.') && run(() => api('/invoices/' + data.invoice.id, { method: 'DELETE' }), 'Fattura annullata')}>Annulla fattura</button>}
          </div>
        ) : (
          <div className="row">
            <span className="muted">Emettendo la fattura il conto viene chiuso e registrato in contabilità.</span><div className="spacer" />
            {checkout ? <button className="btn primary" onClick={doCheckout}>{Number(pay.amount) > 0 ? `Incassa CHF ${chf(pay.amount)} ed emetti fattura` : 'Emetti fattura e chiudi'}</button>
              : <button className="btn" onClick={() => run(() => api(`/bookings/${data.booking.id}/invoice`, { body: {} }), 'Fattura emessa')}>Emetti fattura</button>}
          </div>
        )}
        {checkout && data.invoice && <div className="row end" style={{ marginTop: 12 }}><button className="btn primary" onClick={doCheckout}>Completa check-out</button></div>}
      </section>
    </div>
  );
}

export default function BookingModal({ id, prefill, onClose, onSwitch }) {
  const { notify, changed, rev } = useApp();
  const [data, reload] = useApi(id ? '/bookings/' + id : null, [rev]);
  const [tab, setTab] = useState('conto');
  const [mode, setMode] = useState(null);
  if (!id) return <Modal title="Nuova prenotazione" onClose={onClose}><BookingForm initial={prefill || {}} onSaved={onSwitch} onCancel={onClose} /></Modal>;
  if (!data) return null;
  const b = data.booking;
  const act = async (status, msg) => { try { await api(`/bookings/${b.id}/status`, { body: { status } }); notify(msg); changed(); reload(); } catch (x) { notify(x.message, true); } };
  const remove = async () => {
    if (!confirm('Eliminare definitivamente la prenotazione?')) return;
    try { await api('/bookings/' + b.id, { method: 'DELETE' }); notify('Prenotazione eliminata'); changed(); onClose(); } catch (x) { notify(x.message, true); }
  };
  const actions = (
    <div className="row">
      {b.status === 'opzione' && <button className="btn" onClick={() => act('confermata', 'Prenotazione confermata')}>Conferma</button>}
      {['opzione', 'confermata'].includes(b.status) && <button className="btn primary" onClick={() => { setTab('ospiti'); setMode('checkin'); }}>Check-in</button>}
      {b.status === 'checkin' && <button className="btn primary" onClick={() => { setTab('conto'); setMode('checkout'); }}>Check-out</button>}
    </div>
  );
  return (
    <Modal title={guestName(b)} onClose={onClose} actions={actions}>
      <div className="row" style={{ marginBottom: 14 }}>
        <KeyTag room={b.room_name} meta={b.room_type} />
        <div>
          <div><b>{dmy(b.arrival)} – {dmy(b.departure)}</b>, {data.nights} {data.nights === 1 ? 'notte' : 'notti'}</div>
          <div className="muted small">{b.adults} adulti{b.children ? `, ${b.children} bambini` : ''}, {b.channel}, {b.code}</div>
        </div>
        <div className="spacer" /><Status s={b.status} />
      </div>
      <div className="tabs" role="tablist">
        {[['conto', 'Conto'], ['ospiti', 'Ospiti e documenti'], ['dati', 'Prenotazione']].map(([k, l]) =>
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); setMode(null); }}>{l}</button>)}
      </div>
      {tab === 'conto' && <FolioTab data={data} reload={reload} checkout={mode === 'checkout'} />}
      {tab === 'ospiti' && <GuestsTab data={data} reload={reload} key={data.booking.status} />}
      {tab === 'dati' && (
        <>
          <BookingForm initial={{ ...b, breakfast: !!b.breakfast, guest: data.guest || {} }} onSaved={() => reload()} />
          <div className="row" style={{ marginTop: 24 }}>
            {!['cancellata', 'checkout'].includes(b.status) && <button className="btn danger" onClick={() => confirm('Cancellare la prenotazione? La camera torna libera.') && act('cancellata', 'Prenotazione cancellata')}>Cancella prenotazione</button>}
            {['confermata', 'opzione'].includes(b.status) && b.arrival <= today() && <button className="btn" onClick={() => act('noshow', 'Segnato come mancato arrivo')}>Mancato arrivo</button>}
            {b.status === 'cancellata' && <button className="btn" onClick={() => act('confermata', 'Prenotazione ripristinata')}>Ripristina</button>}
            <div className="spacer" />
            {!data.invoice && data.payments.length === 0 && <button className="btn ghost danger" onClick={remove}>Elimina</button>}
          </div>
        </>
      )}
    </Modal>
  );
}
