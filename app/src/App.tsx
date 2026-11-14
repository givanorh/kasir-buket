import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './lib/db';
import { loadSession, useSession } from './lib/session';
import { sync, useSyncStatus } from './lib/sync';
import { startPrintStation, stopPrintStation } from './lib/print';
import { Toasts } from './components/ui';
import Setup from './pages/Setup';
import Kasir from './pages/Kasir';
import Pesanan from './pages/Pesanan';
import Produksi from './pages/Produksi';
import Produk from './pages/Produk';
import Pelanggan from './pages/Pelanggan';
import Laporan from './pages/Laporan';
import ShiftPage from './pages/Shift';
import Pengaturan from './pages/Pengaturan';
import type { Role } from './lib/types';
import type { ReactElement } from 'react';

const PAGES: { key: string; label: string; icon: string; roles: Role[]; el: () => ReactElement }[] = [
  { key: 'kasir', label: 'Kasir', icon: '🧾', roles: ['owner', 'kasir'], el: () => <Kasir /> },
  { key: 'pesanan', label: 'Pesanan', icon: '📋', roles: ['owner', 'kasir'], el: () => <Pesanan /> },
  { key: 'produksi', label: 'Produksi', icon: '💐', roles: ['owner', 'kasir', 'perangkai'], el: () => <Produksi /> },
  { key: 'produk', label: 'Produk', icon: '🏷️', roles: ['owner'], el: () => <Produk /> },
  { key: 'pelanggan', label: 'Pelanggan', icon: '👥', roles: ['owner', 'kasir'], el: () => <Pelanggan /> },
  { key: 'shift', label: 'Shift', icon: '💵', roles: ['owner', 'kasir'], el: () => <ShiftPage /> },
  { key: 'laporan', label: 'Laporan', icon: '📊', roles: ['owner'], el: () => <Laporan /> },
  { key: 'pengaturan', label: 'Pengaturan', icon: '⚙️', roles: ['owner', 'kasir', 'perangkai'], el: () => <Pengaturan /> },
];

function useHash() {
  const [h, setH] = useState(() => location.hash.replace(/^#\/?/, ''));
  useEffect(() => {
    const f = () => setH(location.hash.replace(/^#\/?/, ''));
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
    <button className={`sync ${cls}`} title={ago !== null ? `Sinkron terakhir ${ago} detik lalu` : 'Belum sinkron'} onClick={() => sync.run()} data-testid="sync-badge">
      <i />{text}
    </button>
  );
}

function Shell() {
  const s = useSession();
  const hash = useHash();
  const role = s.user!.role;
  const allowed = PAGES.filter((p) => p.roles.includes(role));
  const page = allowed.find((p) => p.key === hash) || allowed[0];
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
      <nav className="side">
        <div className="brand">💐 <span>{store?.store_name || 'Kasir Buket'}</span></div>
        {allowed.map((p) => (
          <a key={p.key} href={`#/${p.key}`} className={p === page ? 'on' : ''}><span className="ic">{p.icon}</span><span className="lb">{p.label}</span></a>
        ))}
      </nav>
      <div className="main">
        <header className="top">
          <h1>{page.label}</h1>
          <div className="top-r">
            <SyncBadge />
            <span className="who">{s.user!.name} · {s.device?.code || '?'}</span>
          </div>
        </header>
        <div className="content">{page.el()}</div>
      </div>
    </div>
  );
}
