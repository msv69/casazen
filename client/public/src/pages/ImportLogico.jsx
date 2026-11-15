import { useRef, useState } from 'react';
import { api, useApi, useApp, chf, dmy } from '../util.jsx';

export default function ImportLogico() {
  const { notify } = useApp();
  const [prev, setPrev] = useState(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [account, setAccount] = useState('');
  const [rename, setRename] = useState(true);
  const [file, setFile] = useState(null);
  const [batches, reloadBatches] = useApi('/import/batches');
  const input = useRef();
  const load = async (f, acc = account) => {
    if (!f) return;
    setFile(f); setBusy(true); setPrev(null);
    const fd = new FormData(); fd.append('file', f); if (acc) fd.append('account', acc);
    try { setPrev(await api('/import/logico/preview', { body: fd })); } catch (x) { notify(x.message, true); } finally { setBusy(false); }
  };
  const commit = async () => {
    setBusy(true);
    try {
      const r = await api('/import/logico/commit', { body: { token: prev.token, renameAccounts: rename } });
      notify(`Importate ${r.imported} registrazioni${r.skipped ? `, ${r.skipped} saltate` : ''}`);
      setPrev(null); setFile(null); reloadBatches();
    } catch (x) { notify(x.message, true); } finally { setBusy(false); }
  };
  const undo = async (b) => {
    if (!confirm(`Annullare l'importazione di “${b.filename}”? Verranno eliminate ${b.remaining} registrazioni.`)) return;
    try { await api('/import/batches/' + b.id, { method: 'DELETE' }); notify('Importazione annullata'); reloadBatches(); } catch (x) { notify(x.message, true); }
  };
  return (
    <>
      <div className="page-head">
        <div><h1>Importa da Logico</h1><div className="sub">Carica le schede contabili (mastrini) esportate da Logico in Excel o CSV. Vedi l'anteprima prima di registrare.</div></div>
      </div>
      <div className={'dropzone' + (over ? ' over' : '')} onClick={() => input.current.click()} role="button" tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && input.current.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); load(e.dataTransfer.files[0]); }}>
        <input ref={input} type="file" accept=".xlsx,.xls,.csv,.txt" hidden onChange={(e) => load(e.target.files[0])} />
        <b>{busy ? 'Lettura in corso…' : file ? file.name : 'Trascina qui il file o tocca per sceglierlo'}</b>
        <div className="muted small">.xlsx, .xls o .csv. Puoi caricare un mastrino alla volta, anche di conti diversi.</div>
      </div>

      {prev && (
        <div className="stack" style={{ marginTop: 16 }}>
          <section className="panel">
            <div className="grid g4 keep">
              <div className="figure"><span className="v">{prev.meta.account.code}</span><span className="l">{prev.meta.account.name || 'Conto del mastrino'}</span></div>
              <div className="figure"><span className="v">{prev.summary.nuovi}</span><span className="l">registrazioni nuove</span></div>
              <div className="figure"><span className="v">{prev.summary.duplicati}</span><span className="l">già presenti, verranno saltate</span></div>
              <div className="figure"><span className="v">{chf(prev.summary.saldo_finale)}</span><span className="l">saldo finale nel file</span></div>
            </div>
            <p className="muted" style={{ marginTop: 12 }}>{prev.meta.source}{prev.meta.period ? `, periodo ${prev.meta.period}` : ''}. Dare CHF {chf(prev.summary.dare)}, avere CHF {chf(prev.summary.avere)}.</p>
            <div className="row">
              <label className="f" style={{ maxWidth: 220 }}>Conto del mastrino
                <input value={account || prev.meta.account.code} onChange={(e) => setAccount(e.target.value)} onBlur={() => account && account !== prev.meta.account.code && load(file, account)} inputMode="numeric" /></label>
            </div>
          </section>
          {prev.warnings.length > 0 && <div className="alert"><b>Da controllare</b><ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{prev.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></div>}
          {prev.summary.errori > 0 && <div className="alert err">{prev.summary.errori} righe non sono leggibili e non verranno importate.</div>}
          {(prev.accountsToCreate.length > 0 || prev.accountsToRename.length > 0) && (
            <section className="panel">
              {prev.accountsToCreate.length > 0 && <><h3>Conti nuovi</h3><p>{prev.accountsToCreate.map((a) => `${a.code} ${a.name}`).join(', ')}</p></>}
              {prev.accountsToRename.length > 0 && (
                <label className="check"><input type="checkbox" checked={rename} onChange={(e) => setRename(e.target.checked)} />
                  Usa i nomi di Logico: {prev.accountsToRename.map((a) => `${a.code} “${a.from}” diventa “${a.to}”`).join('; ')}</label>
              )}
            </section>
          )}
          <section className="panel"><div className="tablewrap"><table className="t">
            <thead><tr><th>Riga</th><th>Data</th><th className="hide-m">Doc.</th><th>Descrizione</th><th>Dare</th><th>Avere</th><th className="num">CHF</th><th>Esito</th></tr></thead>
            <tbody>{prev.rows.map((r) => (
              <tr key={r.line}><td className="muted">{r.line}</td><td>{dmy(r.date)}</td><td className="hide-m">{r.doc_no}<div className="muted small">{r.doc_type}</div></td>
                <td>{r.description}{r.message && <div className="small muted">{r.message}</div>}</td>
                <td>{r.debit_account}</td><td>{r.credit_account}</td><td className="num">{r.amount != null ? chf(r.amount) : ''}</td>
                <td><span className={'pill ' + r.status}>{r.status}</span></td></tr>))}</tbody>
          </table></div></section>
          <div className="row end">
            <button className="btn" onClick={() => { setPrev(null); setFile(null); }}>Annulla</button>
            <button className="btn primary" onClick={commit} disabled={busy || prev.summary.nuovi === 0}>Importa {prev.summary.nuovi} registrazioni</button>
          </div>
        </div>
      )}

      <section className="panel" style={{ marginTop: 24 }}>
        <h2>Importazioni eseguite</h2>
        {batches?.length === 0 ? <p className="muted">Nessuna importazione.</p> : (
          <div className="tablewrap"><table className="t">
            <thead><tr><th>Data</th><th>File</th><th>Conto</th><th className="num">Registrate</th><th className="num hide-m">Saltate</th><th /></tr></thead>
            <tbody>{batches?.map((b) => (
              <tr key={b.id}><td>{dmy(b.imported_at)}</td><td>{b.filename}<div className="muted small">{b.period}</div></td><td>{b.account}</td>
                <td className="num">{b.remaining}</td><td className="num hide-m">{b.skipped}</td>
                <td>{b.remaining > 0 && <button className="btn sm danger" onClick={() => undo(b)}>Annulla importazione</button>}</td></tr>))}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
