import React, { useEffect, useState, useCallback } from 'react';
try { const t = localStorage.getItem('theme'); if (t) document.documentElement.dataset.theme = t; } catch {}
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import './styles.css';
import { api, AppCtx } from './util.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Planning from './pages/Planning.jsx';
import Bookings from './pages/Bookings.jsx';
import Guests from './pages/Guests.jsx';
import Invoices from './pages/Invoices.jsx';
import Accounting from './pages/Accounting.jsx';
import ImportLogico from './pages/ImportLogico.jsx';
import TouristTax from './pages/TouristTax.jsx';
import Settings from './pages/Settings.jsx';
import BookingModal from './pages/BookingModal.jsx';

const I = {
  oggi: <path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" />,
  planning: <path d="M4 5h16v15H4zM4 10h16M9 5v15M8 3v4M16 3v4" />,
  pren: <path d="M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5" />,
  ospiti: <path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21c0-4 3-6 7-6s7 2 7 6M17 11a3 3 0 1 0 0-6M19 15c2 .6 3 2.4 3 5" />,
  conti: <path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2zM9 8h6M9 12h6M9 16h3" />,
  cont: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  imp: <path d="M12 3v12M7 10l5 5 5-5M4 21h16" />,
  tassa: <path d="M3 21h18M5 21V10l7-6 7 6v11M10 21v-6h4v6" />,
  set: <path d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />,
  more: <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth="3" />,
};
const Icon = ({ n }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{I[n]}</svg>;

function Login({ onLogin }) {
  const [u, setU] = useState(''); const [p, setP] = useState(''); const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    try { onLogin(await api('/login', { body: { username: u, password: p } })); } catch (x) { setErr(x.message); }
  };
  return (
    <div className="login">
      <form className="panel stack" onSubmit={submit}>
        <div className="keytag"><span className="tag">R</span></div>
        <h1>Reception</h1>
        <p className="muted">Accedi per gestire camere, ospiti e contabilità.</p>
        <label className="f">Nome utente<input autoFocus autoComplete="username" value={u} onChange={(e) => setU(e.target.value)} /></label>
        <label className="f">Password<input type="password" autoComplete="current-password" value={p} onChange={(e) => setP(e.target.value)} /></label>
        {err && <div className="alert err">{err}</div>}
        <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }}>Accedi</button>
      </form>
    </div>
  );
}

function Shell({ user, settings, setUser }) {
  const [toast, setToast] = useState(null);
  const [booking, setBooking] = useState(null); // {id} o {prefill}
  const [rev, setRev] = useState(0);
  const [more, setMore] = useState(false);
  const loc = useLocation();
  useEffect(() => setMore(false), [loc.pathname]);
  const notify = useCallback((msg, err) => { setToast({ msg, err }); setTimeout(() => setToast(null), 3500); }, []);
  const isAdmin = user.role === 'admin';
  const ctx = {
    user, settings: settings.data, reloadSettings: settings.reload, notify, isAdmin, rev,
    openBooking: (id) => setBooking({ id }), newBooking: (prefill = {}) => setBooking({ prefill }),
    changed: () => setRev((r) => r + 1),
  };
  const logout = async () => { await api('/logout', { body: {} }); setUser(null); };
  const links = [
    ['/', 'oggi', 'Oggi'], ['/planning', 'planning', 'Planning'], ['/prenotazioni', 'pren', 'Prenotazioni'], ['/ospiti', 'ospiti', 'Ospiti'],
    ['/fatture', 'conti', 'Fatture e incassi'], ['/tassa', 'tassa', 'Tassa e notifiche'],
  ];
  const adminLinks = [['/contabilita', 'cont', 'Contabilità'], ['/importa', 'imp', 'Importa da Logico']];
  return (
    <AppCtx.Provider value={ctx}>
      <div className="shell">
        <nav className="side" aria-label="Menu principale">
          <div className="prop">{settings.data?.property?.name || 'Reception'}</div>
          {links.map(([to, i, l]) => <NavLink key={to} to={to} end className="navlink"><Icon n={i} />{l}</NavLink>)}
          {isAdmin && <div className="group">Amministrazione</div>}
          {isAdmin && adminLinks.map(([to, i, l]) => <NavLink key={to} to={to} className="navlink"><Icon n={i} />{l}</NavLink>)}
          <NavLink to="/impostazioni" className="navlink"><Icon n="set" />Impostazioni</NavLink>
          <div className="user">{user.name}<br /><button className="btn ghost sm" style={{ padding: 0 }} onClick={logout}>Esci</button></div>
        </nav>
        <main className="main">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/planning" element={<Planning />} />
            <Route path="/prenotazioni" element={<Bookings />} />
            <Route path="/ospiti" element={<Guests />} />
            <Route path="/fatture" element={<Invoices />} />
            <Route path="/tassa" element={<TouristTax />} />
            {isAdmin && <Route path="/contabilita" element={<Accounting />} />}
            {isAdmin && <Route path="/importa" element={<ImportLogico />} />}
            <Route path="/impostazioni" element={<Settings onLogout={logout} />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </main>
        <nav className="tabbar" aria-label="Menu">
          {links.slice(0, 4).map(([to, i, l]) => <NavLink key={to} to={to} end><Icon n={i} />{l}</NavLink>)}
          <button onClick={() => setMore(true)}><Icon n="more" />Altro</button>
        </nav>
        {more && (
          <div className="moremenu" onClick={() => setMore(false)}>
            <div className="sheet" onClick={(e) => e.stopPropagation()}>
              {[...links.slice(4), ...(isAdmin ? adminLinks : []), ['/impostazioni', 'set', 'Impostazioni']].map(([to, i, l]) =>
                <NavLink key={to} to={to} className="navlink"><Icon n={i} />{l}</NavLink>)}
              <button className="navlink btn ghost" onClick={logout}>Esci</button>
            </div>
          </div>
        )}
      </div>
      {booking && <BookingModal {...booking} onClose={() => setBooking(null)} onSwitch={(id) => setBooking({ id })} />}
      {toast && <div className={'toast' + (toast.err ? ' err' : '')} role="status">{toast.msg}</div>}
    </AppCtx.Provider>
  );
}

function Root() {
  const [user, setUser] = useState(undefined);
  const [settings, setSettings] = useState(null);
  const loadSettings = useCallback(() => api('/settings').then(setSettings).catch(() => {}), []);
  useEffect(() => { api('/me').then(setUser).catch(() => setUser(null)); }, []);
  useEffect(() => { if (user) loadSettings(); }, [user, loadSettings]);
  useEffect(() => { const h = () => setUser(null); window.addEventListener('unauthorized', h); return () => window.removeEventListener('unauthorized', h); }, []);
  if (user === undefined) return null;
  if (!user) return <Login onLogin={setUser} />;
  if (!settings) return null;
  return <BrowserRouter><Shell user={user} setUser={setUser} settings={{ data: settings, reload: loadSettings }} /></BrowserRouter>;
}

createRoot(document.getElementById('root')).render(<Root />);
if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('/sw.js');
