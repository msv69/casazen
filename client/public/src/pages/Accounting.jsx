import { useState } from 'react';
import { api, useApi, useApp, Modal, Field, chf, dmy, today, download, monthName } from '../util.jsx';

const SOURCE = { manuale: 'Manuale', logico: 'Logico', fattura: 'Fattura', pagamento: 'Incasso', otr: 'OTR' };
const TEMPLATES = [
  ['Spesa pagata in banca', '6200', '1020'], ['Spesa pagata in contanti', '4000', '1000'], ['Fattura fornitore da pagare', '6200', '2000'],
  ['Pagamento fornitore', '2000', '1020'], ['Versamento contanti in banca', '1020', '1000'], ['Accredito carte/TWINT in banca', '1020', '1091'],
  ['Versamento tassa di soggiorno alla OTR', '2210', '1020'], ['Pagamento IVA', '2200', '1020'], ['Altro', '', ''],
];

function EntryEditor({ entry, accounts, onClose, onSaved }) {
  const { notify } = useApp();
  const [e, setE] = useState(entry || { date: today(), debit_account: '6200', credit_account: '1020', amount: '', description: '', doc_no: '', doc_type: '' });
  const set = (k) => (ev) => setE({ ...e, [k]: ev.target.value });
  const locked = ['fattura', 'pagamento'].includes(e.source);
  const save = async (ev) => {
    ev.preventDefault();
    try { e.id ? await api('/journal/' + e.id, { method: 'PUT', body: e }) : await api('/journal', { body: e }); notify('Registrazione salvata'); onSaved(); onClose(); }
    catch (x) { notify(x.message, true); }
  };
  const del = async () => { if (!confirm('Eliminare la registrazione?')) return; try { await api('/journal/' + e.id, { method: 'DELETE' }); notify('Registrazione eliminata'); onSaved(); onClose(); } catch (x) { notify(x.message, true); } };
  const sel = (k) => <select value={e[k]} onChange={set(k)} disabled={locked} required><option value="">Scegli…</option>{accounts.map((a) => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}</select>;
  return (
    <Modal title={e.id ? 'Registrazione' : 'Nuova registrazione'} onClose={onClose} narrow>
      <form className="stack" onSubmit={save}>
        {locked && <div className="alert">Generata da {SOURCE[e.source].toLowerCase()}: per modificarla agisci sul conto della prenotazione.</div>}
        {!e.id && <Field label="Tipo di operazione"><select onChange={(ev) => { const t = TEMPLATES[ev.target.value]; setE({ ...e, debit_account: t[1], credit_account: t[2], description: e.description || (t[0] !== 'Altro' ? t[0] : '') }); }}>
          {TEMPLATES.map((t, i) => <option key={i} value={i}>{t[0]}</option>)}</select></Field>}
        <div className="form">
          <Field label="Data"><input type="date" value={e.date} onChange={set('date')} disabled={locked} required /></Field>
          <Field label="Importo CHF"><input type="number" step="0.01" min="0.01" value={e.amount} onChange={set('amount')} disabled={locked} required /></Field>
          <Field label="N. documento"><input value={e.doc_no || ''} onChange={set('doc_no')} disabled={locked} /></Field>
          <Field label="Tipo documento"><input value={e.doc_type || ''} onChange={set('doc_type')} disabled={locked} placeholder="FATP, CONT…" /></Field>
          <Field label="Dare" wide>{sel('debit_account')}</Field>
          <Field label="Avere" wide>{sel('credit_account')}</Field>
          <Field label="Descrizione" wide><input value={e.description || ''} onChange={set('description')} disabled={locked} /></Field>
        </div>
        {!locked && <div className="row">{e.id && <button type="button" className="btn ghost danger" onClick={del}>Elimina</button>}<div className="spacer" /><button className="btn primary">Salva registrazione</button></div>}
      </form>
    </Modal>
  );
}

function Journal({ accounts, onChange }) {
  const year = today().slice(0, 4);
  const [from, setFrom] = useState(`${year}-01-01`); const [to, setTo] = useState(`${year}-12-31`);
  const [q, setQ] = useState(''); const [edit, setEdit] = useState(null);
  const [rows, reload] = useApi(`/journal?from=${from}&to=${to}&q=${encodeURIComponent(q)}`);
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 160 }} aria-label="Dal" />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 160 }} aria-label="Al" />
        <input placeholder="Cerca descrizione, documento o conto" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 280 }} aria-label="Cerca" />
        <div className="spacer" />
        <button className="btn" onClick={() => download(`/export/journal.csv?from=${from}&to=${to}`)}>Esporta CSV</button>
        <button className="btn primary" onClick={() => setEdit({})}>Nuova registrazione</button>
      </div>
      <section className="panel">
        {rows?.length === 0 ? <div className="empty">Nessuna registrazione nel periodo. Importa un mastrino da Logico o aggiungi una registrazione.</div> : (
          <div className="tablewrap"><table className="t">
            <thead><tr><th>Data</th><th className="hide-m">Doc.</th><th>Descrizione</th><th>Dare</th><th>Avere</th><th className="num">CHF</th><th className="hide-m">Origine</th></tr></thead>
            <tbody>{rows?.map((j) => (
              <tr key={j.id} className="click" onClick={() => setEdit(j)}>
                <td>{dmy(j.date)}</td><td className="hide-m" style={{ whiteSpace: 'nowrap' }}>{j.doc_no}<div className="muted small">{j.doc_type}</div></td><td>{j.description}</td>
                <td>{j.debit_account}<div className="muted small hide-m">{j.debit_name}</div></td><td>{j.credit_account}<div className="muted small hide-m">{j.credit_name}</div></td>
                <td className="num">{chf(j.amount)}</td><td className="hide-m muted small">{SOURCE[j.source] || j.source}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </section>
      {edit && <EntryEditor entry={edit.id ? edit : null} accounts={accounts} onClose={() => setEdit(null)} onSaved={() => { reload(); onChange(); }} />}
    </>
  );
}

function Ledger({ code, onClose }) {
  const year = today().slice(0, 4);
  const [from, setFrom] = useState(`${year}-01-01`); const [to, setTo] = useState(`${year}-12-31`);
  const [l] = useApi(`/ledger/${code}?from=${from}&to=${to}`);
  if (!l) return null;
  return (
    <Modal title={`Mastrino ${l.account.code} ${l.account.name}`} onClose={onClose}>
      <div className="row" style={{ marginBottom: 12 }}>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 160 }} aria-label="Dal" />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 160 }} aria-label="Al" />
        <div className="spacer" /><button className="btn" onClick={() => print()}>Stampa</button>
      </div>
      <section className="panel"><div className="tablewrap"><table className="t">
        <thead><tr><th>Data</th><th>Descrizione</th><th className="hide-m">Contropartita</th><th className="num">Dare</th><th className="num">Avere</th><th className="num">Saldo</th></tr></thead>
        <tbody>
          <tr><td>{dmy(from)}</td><td className="muted">Riporto</td><td className="hide-m" /><td /><td /><td className="num">{chf(l.opening)}</td></tr>
          {l.rows.map((r) => (
            <tr key={r.id}><td>{dmy(r.date)}</td><td>{r.description}<div className="muted small">{r.doc_no}</div></td><td className="hide-m">{r.contra} {r.contra_name}</td>
              <td className="num">{r.dare ? chf(r.dare) : ''}</td><td className="num">{r.avere ? chf(r.avere) : ''}</td><td className={'num' + (r.saldo < 0 ? ' neg' : '')}>{chf(r.saldo)}</td></tr>))}
        </tbody>
        <tfoot><tr><td colSpan="2">Totali</td><td className="hide-m" /><td className="num">{chf(l.dare)}</td><td className="num">{chf(l.avere)}</td><td className="num">{chf(l.closing)}</td></tr></tfoot>
      </table></div></section>
    </Modal>
  );
}

function Accounts({ accounts, reload }) {
  const { notify } = useApp();
  const [ledger, setLedger] = useState(null);
  const [n, setN] = useState({ code: '', name: '' });
  const groups = [['attivo', 'Attivi'], ['passivo', 'Passivi e capitale'], ['ricavo', 'Ricavi'], ['costo', 'Costi'], ['chiusura', 'Chiusura']];
  const add = async (e) => { e.preventDefault(); try { await api('/accounts', { body: n }); setN({ code: '', name: '' }); reload(); notify('Conto aggiunto'); } catch (x) { notify(x.message, true); } };
  return (
    <>
      <div className="grid g2">
        {groups.map(([t, l]) => {
          const list = accounts.filter((a) => a.type === t);
          if (!list.length) return null;
          return (
            <section className="panel" key={t}><h3>{l}</h3>
              <table className="t"><tbody>{list.map((a) => (
                <tr key={a.code} className="click" onClick={() => setLedger(a.code)}><td style={{ width: 60 }}>{a.code}</td><td>{a.name}</td>
                  <td className={'num' + (!a.dare && !a.avere ? ' muted' : '')}>{chf(['passivo', 'ricavo'].includes(t) ? -a.saldo : a.saldo)}</td></tr>))}</tbody></table>
            </section>);
        })}
        <section className="panel"><h3>Nuovo conto</h3>
          <form className="form" onSubmit={add}>
            <Field label="Numero"><input value={n.code} onChange={(e) => setN({ ...n, code: e.target.value })} inputMode="numeric" /></Field>
            <Field label="Nome"><input value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} /></Field>
            <div style={{ alignSelf: 'end' }}><button className="btn">Aggiungi conto</button></div>
          </form>
          <p className="muted small" style={{ marginTop: 10 }}>Il tipo si ricava dal numero secondo il piano contabile PMI: 1 attivi, 2 passivi, 3 ricavi, 4–8 costi.</p>
        </section>
      </div>
      {ledger && <Ledger code={ledger} onClose={() => setLedger(null)} />}
    </>
  );
}

function Monthly() {
  const [year, setYear] = useState(today().slice(0, 4));
  const [r] = useApi('/reports/monthly?year=' + year);
  if (!r) return null;
  const sum = (k) => r.months.reduce((a, m) => a + m[k], 0);
  const max = Math.max(1, ...r.months.map((m) => Math.max(m.ricavi, m.costi)));
  return (
    <div className="stack">
      <div className="row"><button className="btn" onClick={() => setYear(String(+year - 1))}>‹</button><b>{year}</b><button className="btn" onClick={() => setYear(String(+year + 1))}>›</button>
        <div className="spacer" /><button className="btn" onClick={() => print()}>Stampa</button></div>
      <section className="panel">
        <h3>Ricavi e costi per mese</h3>
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: 140, marginTop: 10 }} aria-hidden="true">
          {r.months.map((m) => (
            <div key={m.month} style={{ flex: 1, display: 'flex', gap: 2, alignItems: 'flex-end', height: '100%' }} title={`${m.month}: ricavi ${chf(m.ricavi)}, costi ${chf(m.costi)}`}>
              <div style={{ flex: 1, height: `${(Math.max(0, m.ricavi) / max) * 100}%`, background: 'var(--lago)', borderRadius: '3px 3px 0 0', minHeight: 1 }} />
              <div style={{ flex: 1, height: `${(Math.max(0, m.costi) / max) * 100}%`, background: 'var(--ottone)', borderRadius: '3px 3px 0 0', minHeight: 1 }} />
            </div>))}
        </div>
        <div className="occ-l" style={{ gap: 6 }}>{r.months.map((m, i) => <span key={i}>{monthName(i).slice(0, 3)}</span>)}</div>
        <div className="legend"><span className="status" style={{ '--c': 'var(--lago)' }}>Ricavi</span><span className="status" style={{ '--c': 'var(--ottone)' }}>Costi</span></div>
      </section>
      <section className="panel"><div className="tablewrap"><table className="t">
        <thead><tr><th>Mese</th><th className="num">Ricavi</th><th className="num">Costi</th><th className="num">Risultato</th><th className="num hide-m">Entrate di cassa</th><th className="num hide-m">Uscite di cassa</th></tr></thead>
        <tbody>{r.months.map((m, i) => (
          <tr key={m.month}><td>{monthName(i)}</td><td className="num">{chf(m.ricavi)}</td><td className="num">{chf(m.costi)}</td>
            <td className={'num' + (m.risultato < 0 ? ' neg' : '')}>{chf(m.risultato)}</td><td className="num hide-m">{chf(m.entrate)}</td><td className="num hide-m">{chf(m.uscite)}</td></tr>))}</tbody>
        <tfoot><tr><td>Anno</td><td className="num">{chf(sum('ricavi'))}</td><td className="num">{chf(sum('costi'))}</td><td className={'num' + (sum('risultato') < 0 ? ' neg' : '')}>{chf(sum('risultato'))}</td>
          <td className="num hide-m">{chf(sum('entrate'))}</td><td className="num hide-m">{chf(sum('uscite'))}</td></tr></tfoot>
      </table></div></section>
      <section className="panel"><h3>Dettaglio per conto</h3><div className="tablewrap"><table className="t">
        <thead><tr><th>Conto</th>{r.months.map((_, i) => <th key={i} className="num hide-m">{monthName(i).slice(0, 3)}</th>)}<th className="num">Anno</th></tr></thead>
        <tbody>{r.accounts.map((a) => (
          <tr key={a.code}><td>{a.code} {a.name}</td>{a.months.map((v, i) => <td key={i} className="num hide-m small">{v ? chf(v) : ''}</td>)}<td className="num"><b>{chf(a.total)}</b></td></tr>))}</tbody>
      </table></div></section>
    </div>
  );
}

function Vat() {
  const y = today().slice(0, 4);
  const [p, setP] = useState(`${y}-S${today().slice(5, 7) <= '06' ? 1 : 2}`);
  const periods = [];
  for (const yy of [+y - 1, +y]) { periods.push([`${yy}-S1`, `1° semestre ${yy}`, `${yy}-01-01`, `${yy}-07-01`], [`${yy}-S2`, `2° semestre ${yy}`, `${yy}-07-01`, `${yy + 1}-01-01`]);
    for (let q = 1; q <= 4; q++) periods.push([`${yy}-T${q}`, `${q}° trimestre ${yy}`, `${yy}-${String(q * 3 - 2).padStart(2, '0')}-01`, q === 4 ? `${yy + 1}-01-01` : `${yy}-${String(q * 3 + 1).padStart(2, '0')}-01`]); }
  const cur = periods.find((x) => x[0] === p);
  const [r] = useApi(`/reports/vat?from=${cur[2]}&to=${cur[3]}`);
  return (
    <div className="stack">
      <div className="row"><select value={p} onChange={(e) => setP(e.target.value)} style={{ width: 'auto' }} aria-label="Periodo">{periods.map((x) => <option key={x[0]} value={x[0]}>{x[1]}</option>)}</select>
        <span className="muted">Metodo effettivo, cifra d'affari convenuta (fatture emesse).</span></div>
      {r && <section className="panel">
        <table className="t"><tbody>
          <tr><td>Fatture emesse</td><td className="num">{r.invoices}</td></tr>
          <tr><td>Cifra d'affari lorda</td><td className="num">{chf(r.gross)}</td></tr>
          <tr><td>di cui non soggetta (tassa di soggiorno, voci esenti)</td><td className="num">{chf(r.exempt)}</td></tr>
          {r.rates.map((x) => <tr key={x.rate}><td>Aliquota {x.rate}%: imponibile {chf(x.gross)} lordo, {chf(x.net)} netto</td><td className="num">{chf(x.vat)}</td></tr>)}
          <tr><td><b>IVA dovuta</b></td><td className="num"><b>{chf(r.vat_due)}</b></td></tr>
          <tr><td>Imposta precedente (conto 1170)</td><td className="num">– {chf(r.input_vat)}</td></tr>
        </tbody><tfoot><tr><td>Da versare all'AFC</td><td className="num">{chf(r.payable)}</td></tr></tfoot></table>
      </section>}
    </div>
  );
}

export default function Accounting() {
  const [tab, setTab] = useState('reg');
  const [accounts, reloadAcc] = useApi('/accounts');
  return (
    <>
      <div className="page-head">
        <div><h1>Contabilità</h1><div className="sub">Partita doppia sul piano contabile PMI svizzero. Fatture e incassi vengono registrati da soli.</div></div>
        <button className="btn" onClick={() => download('/backup')}>Scarica backup</button>
      </div>
      <div className="tabs">
        {[['reg', 'Registrazioni'], ['conti', 'Conti e mastrini'], ['mese', 'Report mensile'], ['iva', 'IVA']].map(([k, l]) =>
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {accounts && tab === 'reg' && <Journal accounts={accounts} onChange={reloadAcc} />}
      {accounts && tab === 'conti' && <Accounts accounts={accounts} reload={reloadAcc} />}
      {tab === 'mese' && <Monthly />}
      {tab === 'iva' && <Vat />}
    </>
  );
}
