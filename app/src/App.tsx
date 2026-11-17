import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './lib/db';
import { loadSession, useSession } from './lib/session';
import { sync, useSyncStatus } from './lib/sync';
import { startPrintStation, stopPrintStation } from './lib/print';
import { Toasts, useThumb } from './components/ui';
import { Icon } from './components/icons';
import { DueAlert, usePendingCancels } from './components/Alerts';
import { useLogout } from './components/Logout';
import Kalender from './pages/Kalender';
import Setup from './pages/Setup';
import Kasir from './pages/Kasir';
import Riwayat from './pages/Pesanan';
import Produksi from './pages/Produksi';
import Produk from './pages/Produk';
import Pelanggan from './pages/Pelanggan';
import Laporan from './pages/Laporan';
import ShiftPage from './pages/Shift';
import Pengaturan from './pages/Pengaturan';
import type { Role } from './lib/types';
import { ROLE_LABEL } from './lib/labels';

export { ROLE_LABEL };

const PAGES: { key: string; label: string; roles: Role[]; el: () => ReactElement }[] = [
  { key: 'kasir', label: 'Kasir', roles: ['owner', 'kasir'], el: () => <Kasir /> },
  { key: 'produksi', label: 'Produksi', roles: ['owner', 'kasir', 'perangkai'], el: () => <Produksi /> },
  { key: 'riwayat', label: 'Riwayat', roles: ['owner', 'kasir', 'perangkai'], el: () => <Riwayat /> },
  { key: 'pelanggan', label: 'Pelanggan', roles: ['owner', 'kasir'], el: () => <Pelanggan /> },
  { key: 'produk', label: 'Produk', roles: ['owner'], el: () => <Produk /> },
  { key: 'shift', label: 'Shift', roles: ['owner', 'kasir'], el: () => <ShiftPage /> },
  { key: 'laporan', label: 'Laporan', roles: ['owner'], el: () => <Laporan /> },
  { key: 'kalender', label: 'Kalender', roles: ['owner'], el: () => <Kalender /> },
  { key: 'pengaturan', label: 'Pengaturan', roles: ['owner', 'kasir', 'perangkai'], el: () => <Pengaturan /> },
];

// tautan lama tetap berlaku: v1.6 Belanja bahan → Laporan › Perhitungan HPP; v1.7 Pesanan → Riwayat
function legacyHash() {
  if (/^#\/?belanja/.test(location.hash)) history.replaceState(null, '', '#/laporan?v=hpp&s=belanja');
  if (/^#\/?pesanan/.test(location.hash)) history.replaceState(null, '', location.hash.replace(/^#\/?pesanan/, '#/riwayat'));
}

function useHash() {
  legacyHash();
  const [h, setH] = useState(() => location.hash.replace(/^#\/?/, ''));
  useEffect(() => {
    const f = () => {
      legacyHash();
      setH(location.hash.replace(/^#\/?/, ''));
    };
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return h;
}

export default function App() {
  const s = useSession();
  const [ready, setReady] = useState(false);
  useEffect(() => { loadSession().then(() => setReady(true)); }, []);
  if (!ready) return <div className="splash">Memuat…</div>;
  return (
    <>
      {s.token && s.user ? <Shell /> : <Setup />}
      <Toasts />
    </>
  );
}

function SyncBadge() {
  const st = useSyncStatus();
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 15000); return () => clearInterval(t); }, []);
  let cls = 'ok', text = 'Tersinkron';
  if (!st.online) { cls = 'off'; text = st.pending ? `Offline · ${st.pending} menunggu` : 'Offline'; }
  else if (st.syncing || st.pending) { cls = 'busy'; text = st.pending ? `Menyinkron · ${st.pending}` : 'Menyinkron…'; }
  const ago = st.lastSync ? Math.round((Date.now() - st.lastSync) / 1000) : null;
  return (
    <button className={`sync ${cls}`} title={st.error && cls !== 'ok' ? st.error : ago !== null ? `Sinkron terakhir ${ago} detik lalu` : 'Belum sinkron'} onClick={() => sync.run()} data-testid="sync-badge">
      <i /><span className="hide-sm">{text}</span>
    </button>
  );
}

const initials = (n: string) => n.replace(/[^\p{L}\s]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

function UserMenu() {
  const s = useSession();
  const outlet = useLiveQuery(() => db.outlets.get(s.user?.outlet_id || 'outlet-utama'), [s.user?.outlet_id]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const f = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', f);
    return () => document.removeEventListener('mousedown', f);
  }, [open]);
  const u = s.user;
  const [requestLogout, logoutModal] = useLogout();
  async function out() { setOpen(false); await requestLogout(); }
  if (!u) return null; // sesaat setelah keluar, sebelum halaman masuk tampil
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className="user-btn" onClick={() => setOpen(!open)} aria-expanded={open} data-testid="user-menu">
        <span className="avatar">{initials(u.name)}</span>
        <span className="who-text"><span className="who-name">{u.name}</span><span className="who-sub">{ROLE_LABEL[u.role]} · {outlet?.name || 'Toko'}</span></span>
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-head"><b>{u.name}</b><div className="muted">@{u.username} · {ROLE_LABEL[u.role]} · perangkat {s.device?.code}</div></div>
          <button role="menuitem" onClick={() => { setOpen(false); location.hash = '#/pengaturan'; }}><Icon name="pengaturan" />Pengaturan</button>
          <button role="menuitem" onClick={out}><Icon name="swap" />Ganti akun</button>
          <button role="menuitem" className="danger" onClick={out}><Icon name="logout" />Keluar</button>
        </div>
      )}
      {logoutModal}
    </div>
  );
}

function Shell() {
  const s = useSession();
  const hash = useHash();
  const role = s.user?.role || 'perangkai';
  const allowed = PAGES.filter((p) => p.roles.includes(role));
  const page = allowed.find((p) => p.key === hash.split('?')[0]) || allowed[0];
  const pendingCancels = usePendingCancels().length;
  const navRef = useRef<HTMLElement>(null);
  const pill = useThumb(navRef, 'a.on', [page.key, allowed.length]);
  const store = useLiveQuery(() => db.settings.get('toko'));

  useEffect(() => {
    sync.start();
    const restart = () => startPrintStation();
    restart();
    window.addEventListener('device-config', restart);
    return () => { window.removeEventListener('device-config', restart); stopPrintStation(); sync.stop(); };
  }, []);

  return (
    <div className="shell">
      <nav className={`side ${pill ? 'has-pill' : ''}`} ref={navRef}>
        {pill && <span className="nav-pill" style={pill} aria-hidden="true" />}
        <div className="brand"><span className="brand-mark"><Icon name="flower" /></span><span>{store?.store_name || 'Kasir Buket'}</span></div>
        {allowed.map((p) => (
          <a key={p.key} href={`#/${p.key}`} className={p === page ? 'on' : ''}><Icon name={p.key} /><span>{p.label}</span>
            {p.key === 'produksi' && role === 'owner' && pendingCancels > 0 && <em className="navbadge" title="Pengajuan pembatalan menunggu persetujuan">{pendingCancels}</em>}</a>
        ))}
      </nav>
      <div className={`main ${page.key === 'kasir' || page.key === 'produksi' ? 'wide' : ''}`}>
        <header className="top">
          <h1>{page.label}</h1>
          <div className="top-r">
            <SyncBadge />
            <UserMenu />
          </div>
        </header>
        <div className="content">{page.key !== 'pengaturan' && <DueAlert />}<div key={page.key} className="view-enter">{page.el()}</div></div>
      </div>
    </div>
  );
}
