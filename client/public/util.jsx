import { createContext, useContext, useEffect, useState, useCallback } from 'react';

export async function api(path, opts = {}) {
  const init = { method: opts.method || (opts.body ? 'POST' : 'GET'), credentials: 'same-origin', headers: {} };
  if (opts.body instanceof FormData) init.body = opts.body;
  else if (opts.body !== undefined) { init.body = JSON.stringify(opts.body); init.headers['content-type'] = 'application/json'; }
  const r = await fetch('/api' + path, init);
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text();
  if (r.status === 401 && path !== '/login' && path !== '/me') { window.dispatchEvent(new Event('unauthorized')); }
  if (!r.ok) throw new Error(data?.error || `Errore ${r.status}`);
  return data;
}

export function useApi(path, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!path) return;
    let live = true;
    api(path).then((d) => live && (setData(d), setError(null))).catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [path, n, ...deps]);
  const reload = useCallback(() => setN((x) => x + 1), []);
  return [data, reload, error];
}

export const today = () => {
  const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10);
};
export const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const nights = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
export const dmy = (s) => (s ? s.slice(0, 10).split('-').reverse().join('.') : '');
export const chf = (n) => Number(n || 0).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const WD = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
const MO = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
export const weekday = (s) => WD[new Date(s + 'T00:00:00Z').getUTCDay()];
export const monthName = (m) => MO[m];
export const longDate = (s) => { const d = new Date(s + 'T00:00:00Z'); return `${WD[d.getUTCDay()]} ${d.getUTCDate()} ${MO[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
export const monthStart = (s) => s.slice(0, 8) + '01';
export const nextMonth = (s) => { const d = new Date(s.slice(0, 8) + '01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 10); };
export const prevMonth = (s) => { const d = new Date(s.slice(0, 8) + '01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); };
export const guestName = (r) => [r?.last_name, r?.first_name].filter(Boolean).join(' ') || 'Ospite senza nome';

export const STATUS_LABEL = { opzione: 'Opzione', confermata: 'Confermata', checkin: 'In casa', checkout: 'Partito', cancellata: 'Cancellata', noshow: 'Mancato arrivo' };
export const CHANNELS = ['Diretto', 'Telefono', 'Email', 'Booking.com', 'Airbnb', 'Expedia', 'Agenzia', 'Altro'];
export const METHODS = { contanti: 'Contanti', carta: 'Carta', twint: 'TWINT', bonifico: 'Bonifico' };
export const Status = ({ s }) => <span className={`status st-${s}`}>{STATUS_LABEL[s] || s}</span>;

export const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

export function Modal({ title, onClose, children, narrow, actions }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k); document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = ''; };
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (narrow ? ' narrow' : '')} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <button className="btn ghost" onClick={onClose} aria-label="Chiudi">✕</button>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <div className="spacer" />
          {actions}
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children, wide }) {
  return <label className={'f' + (wide ? ' wide' : '')}>{label}{children}</label>;
}

export function KeyTag({ room, meta }) {
  return <span className="keytag"><span className="tag">{room}</span>{meta && <span className="meta">{meta}</span>}</span>;
}

export function download(path) { window.location.href = '/api' + path; }
