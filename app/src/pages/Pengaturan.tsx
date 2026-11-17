import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { api, isNative, useSession } from '../lib/session';
import { useLogout } from '../components/Logout';
import { sync, useSyncStatus } from '../lib/sync';
import { getDeviceConfig, newId, save, setDeviceConfig, type DeviceConfig, type PrinterConfig, type PrinterMode } from '../lib/store';
import { sendToPrinter, ThermalPrinter } from '../lib/print';
import { buildTest } from '../lib/print/receipts';
import { planImport, runImport, type ImportPlan } from '../lib/kasirpintar';
import { Badge, Empty, Field, Modal, MoneyInput, Seg, TabPanel, toast } from '../components/ui';
import { Icon } from '../components/icons';
import { DEFAULT_DRAWER_FLOAT, DEFAULT_PETTY_TARGET, DEFAULT_SURVEY, answerOf, storeCfg } from '../lib/settings';
import { REVIEW_ACCEPT_RATE, budgetLeft, budgetSuggestion, monthKey, monthStartIso, reviewTiers, reviewUsage, tierAmount } from '../lib/review';
import { parseLocalInput } from '../lib/geo';
import { num, rp } from '../lib/format';
import { FN_OPTIONS, KIND_OPTIONS, codeMeaning, sampleNo, splitCode, type DeviceFn, type DeviceKind } from '../lib/device';
import { ROLE_LABEL } from '../lib/labels';
import type { EngageCfg, Outlet, PrintTarget, ReviewTier, Role, Settings, SurveyQuestion } from '../lib/types';
import { fmtShort } from '../lib/format';

export default function Pengaturan() {
  const s = useSession();
  const owner = s.user?.role === 'owner';
  type Tab = 'perangkat' | 'printer' | 'reset' | 'toko' | 'promo' | 'perangkai' | 'survei' | 'pengguna' | 'email' | 'impor';
  const [tab, setTab] = useState<Tab>('perangkat');
  const tabs: { value: Tab; label: string }[] = [
    { value: 'perangkat', label: 'Perangkat' },
    { value: 'printer', label: 'Printer' },
    ...(!owner ? [{ value: 'reset', label: 'Reset Password' }] as { value: Tab; label: string }[] : []),
    ...(owner ? [
      { value: 'toko', label: 'Toko & cabang' }, { value: 'promo', label: 'Promo, poin & ongkir' }, { value: 'perangkai', label: 'Perangkai' },
      { value: 'survei', label: 'Survei' }, { value: 'pengguna', label: 'Pengguna' }, { value: 'email', label: 'Reset Password' }, { value: 'impor', label: 'Impor Kasir Pintar' },
    ] as { value: Tab; label: string }[] : []),
  ];
  return (
    <div className="page">
      <div className="toolbar"><Seg value={tab} onChange={setTab} options={tabs} /></div>
      <TabPanel k={tab} order={tabs.map((t) => t.value)}>
      {tab === 'perangkat' && <DeviceTab />}
      {tab === 'printer' && <PrinterTab />}
      {tab === 'reset' && !owner && <SelfResetTab />}
      {tab === 'toko' && owner && <StoreTab />}
      {tab === 'pengguna' && owner && <UsersTab />}
      {tab === 'promo' && owner && <PromoTab />}
      {tab === 'perangkai' && owner && <FloristTab />}
      {tab === 'survei' && owner && <SurveyTab />}
      {tab === 'email' && owner && <EmailTab />}
      {tab === 'impor' && owner && <ImportTab />}
      </TabPanel>
    </div>
  );
}

function useDeviceConfig(): [DeviceConfig | null, (c: DeviceConfig) => void] {
  const [cfg, setCfg] = useState<DeviceConfig | null>(null);
  useEffect(() => { getDeviceConfig().then(setCfg); }, []);
  return [cfg, (c) => { setCfg(c); setDeviceConfig(c); }];
}

function DeviceTab() {
  const s = useSession();
  const st = useSyncStatus();
  const outlets = useLiveQuery(() => db.outlets.toArray(), []) || [];
  const [cfg, setCfg] = useDeviceConfig();
  const code = s.device?.code || '';
  const owner = s.user?.role === 'owner';
  const [requestLogout, logoutModal] = useLogout();
  if (!cfg) return null;
  return (
    <div className="stack">
      {logoutModal}
      <div className="two">
        <section className="card">
          <h3>Perangkat ini</h3>
          <div className="devcode">
            <span className="code" data-testid="device-code">{code || '?'}</span>
            <div><b data-testid="device-name">{s.device?.name || codeMeaning(code)}</b><div className="muted">{codeMeaning(code)} · awalan nomor struk: {code ? `${sampleNo(code)}, ${sampleNo(code).replace(/001$/, '002')}, …` : '-'}</div></div>
          </div>
          <p className="muted small">Perangkat dikenali otomatis saat masuk (jenis dari layar perangkat, fungsi awal dari peran akun). Nama dan kategori {owner ? 'bisa Anda ubah di daftar Perangkat terdaftar di bawah.' : 'diatur owner di Pengaturan › Perangkat.'}</p>
          <dl className="dl">
            <dt>Pengguna</dt><dd>{s.user?.name} · {s.user ? ROLE_LABEL[s.user.role] : ''}</dd>
            <dt>Server</dt><dd className="break">{s.serverUrl}</dd>
          </dl>
          <Field label="Cabang perangkat ini">
            <select value={cfg.outletId} onChange={(e) => setCfg({ ...cfg, outletId: e.target.value })}>
              {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </Field>
          <button className="btn danger" onClick={() => requestLogout('Keluar dari akun di perangkat ini? Data yang belum tersinkron tetap tersimpan.')}>Keluar</button>
        </section>
        <section className="card">
          <h3>Sinkronisasi otomatis</h3>
          <dl className="dl">
            <dt>Status</dt><dd>{st.online ? (st.pending ? `${st.pending} perubahan menunggu` : 'Tersinkron') : 'Offline'}</dd>
            <dt>Terakhir</dt><dd>{st.lastSync ? new Date(st.lastSync).toLocaleTimeString('id-ID') : '-'}</dd>
            <dt>Nomor urut data</dt><dd>{num(st.cursor)}</dd>
          </dl>
          <p className="muted small">Sinkron berjalan sendiri: saat aplikasi dibuka, setiap ada transaksi, saat perangkat lain mengubah data (realtime), dan saat internet kembali. Tidak perlu menekan tombol.</p>
          <button className="btn" onClick={() => sync.resync()}>Tarik ulang semua data</button>
        </section>
      </div>
      {owner && <DeviceAdmin />}
    </div>
  );
}

interface DeviceRow { id: string; code: string; name?: string | null; ua?: string | null; logins: number; created_at: string; last_seen?: string | null; user_name?: string | null; user_role?: Role | null; current: boolean }
interface LoginRow { at: string; ua?: string | null; device_id: string; code?: string | null; device_name?: string | null; user_name?: string | null; user_role?: Role | null }
type DevDraft = { name: string; kind: DeviceKind | ''; fn: DeviceFn | '' };

/** Owner: semua perangkat yang pernah masuk (riwayat login). Ganti nama dan kategori di sini, bukan di layar masuk. */
function DeviceAdmin() {
  const [rows, setRows] = useState<DeviceRow[]>([]);
  const [logins, setLogins] = useState<LoginRow[]>([]);
  const [draft, setDraft] = useState<Record<string, DevDraft>>({});
  const [busy, setBusy] = useState('');
  const [showLog, setShowLog] = useState(false);
  // rekaman `devices` ikut sinkron: daftar dimuat ulang begitu ada perangkat baru masuk atau berubah
  const stamp = useLiveQuery(async () => (await db.devices.toArray()).map((d) => `${d.id}:${d.code}:${d.name}:${d.last_seen}`).sort().join('|'), []);
  const load = () => api<{ devices: DeviceRow[]; logins: LoginRow[] }>('/api/devices?limit=30')
    .then((r) => { setRows(r.devices); setLogins(r.logins); }).catch((e) => toast(e.message, 'err'));
  useEffect(() => { load(); }, [stamp]); // eslint-disable-line
  const base = (d: DeviceRow): DevDraft => { const c = splitCode(d.code); return { name: d.name || '', kind: c?.kind || '', fn: c?.fn || '' }; };
  const cur = (d: DeviceRow) => draft[d.id] || base(d);
  const edit = (d: DeviceRow, p: Partial<DevDraft>) => setDraft({ ...draft, [d.id]: { ...cur(d), ...p } });
  const dirty = (d: DeviceRow) => { const a = cur(d), b = base(d); return a.name.trim() !== b.name || a.kind !== b.kind || a.fn !== b.fn; };
  async function saveRow(d: DeviceRow) {
    const v = cur(d), b = base(d);
    if ((v.kind || v.fn) && !(v.kind && v.fn)) { toast('Pilih jenis dan fungsi perangkat', 'err'); return; }
    setBusy(d.id);
    try {
      const body: Record<string, string> = {};
      if (v.name.trim() !== b.name) body.name = v.name.trim();
      if (v.kind && v.fn && (v.kind !== b.kind || v.fn !== b.fn)) { body.kind = v.kind; body.fn = v.fn; }
      const r = await api<{ device: { code: string; name: string } }>(`/api/devices/${d.id}`, { method: 'PATCH', body });
      toast(r.device.code !== d.code ? `${r.device.name}: kode sekarang ${r.device.code}, nomor struk berikutnya ${sampleNo(r.device.code)}` : `Nama perangkat disimpan: ${r.device.name}`);
      const { [d.id]: _, ...rest } = draft; setDraft(rest);
      await load();
      sync.run();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(''); }
  }
  const who = (n?: string | null, r?: Role | null) => (n ? `${n}${r ? ` (${ROLE_LABEL[r]})` : ''}` : 'pengguna dihapus');
  return (
    <section className="card" data-testid="device-admin">
      <h3>Perangkat terdaftar</h3>
      <p className="muted small">Setiap perangkat yang pernah masuk tercatat otomatis di sini. Beri nama agar mudah dikenali (mis. “Tablet depan”, “HP Nazra”). Kategori menentukan kode awalan nomor struk: huruf pertama K = Komputer, H = HP, T = Tablet; huruf kedua K = Kasir, R = Ruang rangkai, O = Owner. Bila kategori diubah, perangkat itu langsung memakai kode baru; nomor struk yang sudah terbit tidak berubah.</p>
      <div className="devlist">
        {rows.map((d) => {
          const v = cur(d);
          return (
            <div key={d.id} className="devrow" data-testid="device-row">
              <span className="code">{d.code}</span>
              <div className="devmain">
                <div className="devedit">
                  <input value={v.name} onChange={(e) => edit(d, { name: e.target.value })} maxLength={40} placeholder={codeMeaning(d.code)} aria-label={`Nama perangkat ${d.code}`} />
                  <select value={v.kind} onChange={(e) => edit(d, { kind: e.target.value as DeviceKind })} aria-label={`Jenis perangkat ${d.code}`}>
                    {!v.kind && <option value="">Jenis…</option>}
                    {KIND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <select value={v.fn} onChange={(e) => edit(d, { fn: e.target.value as DeviceFn })} aria-label={`Fungsi perangkat ${d.code}`}>
                    {!v.fn && <option value="">Fungsi…</option>}
                    {FN_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <button className="btn small primary" disabled={!dirty(d) || busy === d.id} onClick={() => saveRow(d)} data-testid="device-save">Simpan</button>
                </div>
                <div className="muted small">
                  {d.current && <Badge tone="green">perangkat ini</Badge>} {d.ua || 'perangkat belum masuk lagi sejak v1.8'} · terakhir masuk {who(d.user_name, d.user_role)} {fmtShort(d.last_seen || d.created_at)}
                  {d.logins > 0 ? ` · ${d.logins}× login` : ''} · terdaftar {fmtShort(d.created_at)}{!splitCode(d.code) ? ' · kode versi lama, pilih jenis dan fungsi untuk memberi kode baru' : ''}
                </div>
              </div>
            </div>
          );
        })}
        {!rows.length && <Empty>Belum ada perangkat.</Empty>}
      </div>
      <button className="linkish small" style={{ alignSelf: 'flex-start' }} onClick={() => setShowLog(!showLog)} data-testid="login-log-toggle">{showLog ? 'Sembunyikan riwayat login' : `Lihat riwayat login (${logins.length} terakhir)`}</button>
      {showLog && (
        <div className="loginlog" data-testid="login-log">
          {logins.map((l, i) => (
            <div key={i} className="row small"><span>{fmtShort(l.at)} · {who(l.user_name, l.user_role)}</span><span className="muted">{l.code || '?'} {l.device_name || ''}{l.ua ? ` · ${l.ua}` : ''}</span></div>
          ))}
          {!logins.length && <p className="muted small">Riwayat login dicatat sejak versi 1.8.</p>}
        </div>
      )}
    </section>
  );
}

const MODE_LABEL: Record<PrinterMode, string> = {
  bluetooth: 'Bluetooth (Android)', lan: 'WiFi/LAN IP (Android)', system: 'Dialog cetak sistem/browser', relay: 'Dicetak perangkat lain (stasiun)', none: 'Tidak dicetak',
};

function PrinterTab() {
  const [cfg, setCfg] = useDeviceConfig();
  const [paired, setPaired] = useState<{ name: string; address: string }[]>([]);
  const settings = useLiveQuery(() => db.settings.get('toko'));
  useEffect(() => {
    if (isNative()) ThermalPrinter.listPaired().then((r) => setPaired(r.devices)).catch((e) => toast('Bluetooth: ' + e.message, 'err'));
  }, []);
  if (!cfg) return null;
  const upd = (t: PrintTarget, p: Partial<PrinterConfig>) => setCfg({ ...cfg, printers: { ...cfg.printers, [t]: { ...cfg.printers[t], ...p } } });
  const modes: PrinterMode[] = isNative() ? ['bluetooth', 'lan', 'relay', 'system', 'none'] : ['system', 'relay', 'none'];
  return (
    <>
      <p className="muted">Setiap transaksi berhasil mencetak 2 lembar: <b>struk pelanggan</b> ke printer kasir dan <b>tiket produksi</b> ke printer ruang perangkai. Bila printer ruang perangkai tidak terjangkau dari perangkat kasir, pilih “Dicetak perangkat lain”, lalu di HP/tablet ruang perangkai aktifkan “Stasiun cetak”.</p>
      <div className="two">
        {(['kasir', 'produksi'] as PrintTarget[]).map((t) => {
          const p = cfg.printers[t];
          return (
            <section key={t} className="card" data-testid={`printer-${t}`}>
              <h3>{t === 'kasir' ? 'Printer kasir (struk pelanggan)' : 'Printer ruang perangkai (tiket produksi)'}</h3>
              <Field label="Cara cetak dari perangkat ini">
                <select value={p.mode} onChange={(e) => upd(t, { mode: e.target.value as PrinterMode })}>
                  {modes.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
                </select>
              </Field>
              {p.mode === 'bluetooth' && (
                <Field label="Printer Bluetooth (pasangkan dulu di pengaturan Bluetooth HP)">
                  <select value={p.address || ''} onChange={(e) => upd(t, { address: e.target.value, name: paired.find((d) => d.address === e.target.value)?.name })}>
                    <option value="">— pilih —</option>
                    {paired.map((d) => <option key={d.address} value={d.address}>{d.name} ({d.address})</option>)}
                  </select>
                </Field>
              )}
              {p.mode === 'lan' && (
                <div className="cols">
                  <Field label="IP printer"><input value={p.host || ''} onChange={(e) => upd(t, { host: e.target.value.trim() })} placeholder="192.168.1.50" /></Field>
                  <Field label="Port"><input type="number" value={p.port || 9100} onChange={(e) => upd(t, { port: Number(e.target.value) })} /></Field>
                </div>
              )}
              {p.mode !== 'relay' && p.mode !== 'none' && (
                <>
                  <div className="cols">
                    <Field group label="Lebar kertas"><Seg value={String(p.width) as '58' | '80'} onChange={(v) => upd(t, { width: Number(v) as 58 | 80 })} options={[{ value: '58', label: '58 mm' }, { value: '80', label: '80 mm' }]} /></Field>
                    <Field label="Jumlah salinan"><input type="number" min={1} max={5} value={p.copies} onChange={(e) => upd(t, { copies: Math.max(1, Math.min(5, Number(e.target.value))) })} /></Field>
                  </div>
                  <label className="check">
                    <input type="checkbox" checked={cfg.stationTargets.includes(t)} data-testid={`station-${t}`}
                      onChange={(e) => setCfg({ ...cfg, stationTargets: e.target.checked ? [...new Set([...cfg.stationTargets, t])] : cfg.stationTargets.filter((x) => x !== t) })} />
                    Stasiun cetak: cetak otomatis {t === 'kasir' ? 'struk' : 'tiket'} yang dikirim perangkat lain
                  </label>
                  <button className="btn" onClick={async () => { try { await sendToPrinter(t, p, buildTest(t, p.width, settings)); toast('Tes dikirim'); } catch (e) { toast((e as Error).message, 'err'); } }}>Tes cetak</button>
                </>
              )}
            </section>
          );
        })}
      </div>
      <label className="check"><input type="checkbox" checked={cfg.autoPrint} onChange={(e) => setCfg({ ...cfg, autoPrint: e.target.checked })} /> Cetak otomatis saat transaksi berhasil</label>
    </>
  );
}

function StoreTab() {
  const st = useLiveQuery(() => db.settings.get('toko'));
  const outlets = useLiveQuery(() => db.outlets.toArray(), []) || [];
  const [f, setF] = useState<Settings | null>(null);
  useEffect(() => { if (st && !f) setF(st); }, [st]); // eslint-disable-line
  if (!f) return null;
  const saveAll = async () => { const { id, created_at, updated_at, ...patch } = f; await save<Settings>('settings', 'toko', patch); toast('Pengaturan toko disimpan'); };
  return (
    <div className="two">
      <section className="card">
        <h3>Data toko & struk</h3>
        <Field label="Nama toko"><input value={f.store_name} onChange={(e) => setF({ ...f, store_name: e.target.value })} /></Field>
        <Field label="Alamat"><input value={f.address || ''} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
        <div className="cols">
          <Field label="Telp/WA"><input value={f.phone || ''} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label="Instagram"><input value={f.instagram || ''} onChange={(e) => setF({ ...f, instagram: e.target.value })} /></Field>
        </div>
        <Field label="Catatan kaki struk"><textarea rows={3} value={f.receipt_footer || ''} onChange={(e) => setF({ ...f, receipt_footer: e.target.value })} /></Field>
        <div className="cols">
          <Field label="Kapasitas buket per hari" hint="0 = tidak dibatasi"><input type="number" min={0} value={f.daily_capacity || 0} onChange={(e) => setF({ ...f, daily_capacity: Number(e.target.value) })} /></Field>
          <Field label="DP default (%)"><input type="number" min={0} max={100} value={f.dp_min_percent ?? 50} onChange={(e) => setF({ ...f, dp_min_percent: Number(e.target.value) })} /></Field>
        </div>
        <Field label="Metode pembayaran (pisahkan koma)"><input value={f.payment_methods.join(', ')} onChange={(e) => setF({ ...f, payment_methods: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /></Field>
        <h3>Laci kas</h3>
        <div className="cols">
          <Field label="Modal laci kasir" hint="Kas awal saat buka shift; hanya untuk kembalian"><MoneyInput value={f.drawer_float || DEFAULT_DRAWER_FLOAT} onChange={(v) => setF({ ...f, drawer_float: v })} ariaLabel="Modal laci kasir" /></Field>
          <Field label="Jumlah tetap laci meja kamar" hint="Kas kecil untuk kas keluar/masuk"><MoneyInput value={f.petty?.target || DEFAULT_PETTY_TARGET} onChange={(v) => setF({ ...f, petty: { ...(f.petty || {}), target: v } })} ariaLabel="Jumlah tetap kas kecil" /></Field>
        </div>
        <h3>Kategori kas keluar</h3>
        {f.expense_categories.map((c, i) => (
          <div key={i} className="row">
            <input value={c.name} onChange={(e) => setF({ ...f, expense_categories: f.expense_categories.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
            <label className="check"><input type="checkbox" checked={c.biaya} onChange={(e) => setF({ ...f, expense_categories: f.expense_categories.map((x, j) => (j === i ? { ...x, biaya: e.target.checked } : x)) })} /> beban</label>
          </div>
        ))}
        <button className="btn small" onClick={() => setF({ ...f, expense_categories: [...f.expense_categories, { name: 'Kategori baru', biaya: true }] })}>＋ Kategori</button>
        <p className="muted small">“Beban” mengurangi laba bersih. Belanja bahan tidak dihitung beban bila HPP produk sudah diisi, agar tidak terhitung dua kali.</p>
        <button className="btn primary" onClick={saveAll}>Simpan</button>
      </section>
      <section className="card">
        <h3>Cabang</h3>
        {outlets.map((o) => <OutletRow key={o.id} o={o} />)}
        <button className="btn" onClick={async () => { const name = prompt('Nama cabang baru?'); if (name) await save<Outlet>('outlets', newId('out'), { name, code: String.fromCharCode(65 + outlets.length), active: true }); }}>＋ Cabang</button>
        <p className="muted small">Produk dipakai bersama semua cabang. Stok, transaksi, dan laporan dicatat per cabang sesuai pilihan di Pengaturan › Perangkat.</p>
      </section>
    </div>
  );
}

function OutletRow({ o }: { o: Outlet }) {
  const [input, setInput] = useState(o.maps_input || '');
  const [busy, setBusy] = useState(false);
  async function locate() {
    setBusy(true);
    try {
      let p = parseLocalInput(input);
      if (!p && /^https?:\/\//i.test(input.trim())) p = { ...(await api<{ lat: number; lng: number }>('/api/geo/expand', { body: { url: input.trim() }, timeout: 20000 })), source: 'link' };
      if (!p) throw new Error('Tempel link Google Maps atau koordinat toko (Plus Code pendek butuh titik acuan, pakai link atau koordinat).');
      await save<Outlet>('outlets', o.id, { location: { lat: p.lat, lng: p.lng }, maps_input: input.trim() });
      toast(`Lokasi ${o.name} disimpan (${p.lat.toFixed(5)}, ${p.lng.toFixed(5)})`);
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  }
  return (
    <div className="box stack">
      <div className="row"><input defaultValue={o.name} onBlur={(e) => e.target.value !== o.name && save<Outlet>('outlets', o.id, { name: e.target.value })} aria-label="Nama cabang" /><Badge>{o.code}</Badge></div>
      <Field label="Lokasi toko (titik awal hitung ongkir)" hint={o.location ? `Tersimpan: ${o.location.lat.toFixed(5)}, ${o.location.lng.toFixed(5)}` : 'Belum diatur'}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Link Google Maps toko atau 3.7536, 98.4497" />
          <button className="btn" disabled={busy || !input.trim()} onClick={locate}><Icon name="pin" size={18} />{busy ? 'Membaca…' : 'Simpan'}</button>
        </div>
      </Field>
    </div>
  );
}

/**
 * Diskon ulasan Google Maps (owner): budget per bulan, belanja minimal, dan kolom diskon yang bisa ditambah/dihapus.
 * Nilai tersimpan bersama tombol "Simpan pengaturan" di tab ini.
 */
function ReviewDiscountCard({ E, setE }: { E: EngageCfg; setE: (p: Partial<EngageCfg>) => void }) {
  const now = new Date();
  const monthOrders = useLiveQuery(() => db.orders.where('created_at').aboveOrEqual(monthStartIso()).toArray(), []) || [];
  const yearOrders = useLiveQuery(() => db.orders.where('created_at').aboveOrEqual(new Date(now.getFullYear(), now.getMonth() - 12, 1).toISOString()).toArray(), []);
  const tiers = reviewTiers(E);
  const setTiers = (review_tiers: ReviewTier[]) => setE({ review_tiers });
  const upd = (id: string, p: Partial<ReviewTier>) => setTiers(tiers.map((t) => (t.id === id ? { ...t, ...p } : t)));
  const usage = reviewUsage(monthOrders, monthKey(now));
  const budget = E.review_budget || 0;
  const left = budgetLeft(budget, usage.used);
  const sug = useMemo(() => (yearOrders ? budgetSuggestion(yearOrders, now, E.every_n, tiers) : null), [yearOrders, E.every_n, tiers]); // eslint-disable-line
  const active = tiers.filter((t) => t.active !== false && t.value > 0);
  const avgFix = active.length ? active.reduce((s, t) => s + tierAmount(t, sug?.avgBasket || 150000), 0) / active.length : 0;
  const monthName = now.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
  const f1 = (n: number) => n.toLocaleString('id-ID', { maximumFractionDigits: 1 });
  return (
    <section className="card" data-testid="review-card">
      <h3>Diskon ulasan Google Maps</h3>
      <div className="rv-top">
        <Field label="Budget per bulan" hint="Rp 0 = tanpa batas. Pop-up menonaktifkan kolom yang melebihi sisa budget.">
          <MoneyInput value={budget} onChange={(review_budget) => setE({ review_budget })} ariaLabel="Budget diskon ulasan per bulan" />
        </Field>
        <Field label="Belanja minimal" hint="Subtotal setelah potongan item. Di bawah nilai ini diskon ulasan tidak ditawarkan.">
          <MoneyInput value={E.review_min_spend || 0} onChange={(review_min_spend) => setE({ review_min_spend })} ariaLabel="Belanja minimal diskon ulasan" />
        </Field>
        <div className="rbudget" data-testid="review-usage">
          <div className="row"><span>Terpakai {monthName}</span><b>{rp(usage.used)}</b></div>
          {budget > 0 && <div className="meter"><i style={{ width: `${Math.min(100, (usage.used / budget) * 100)}%` }} /></div>}
          <div className="muted small">{num(usage.count)} transaksi{budget > 0 ? ` · sisa ${rp(left)} (${f1(budget ? (left / budget) * 100 : 0)}%)` : ' · tanpa batas budget'}</div>
        </div>
      </div>

      <div className="section-title">Kolom diskon</div>
      <div className="rv-table" role="table" aria-label="Kolom diskon ulasan">
        <div className="rv-row head" role="row"><span>Aktif</span><span>Nama kolom</span><span>Jenis</span><span>Nilai</span><span>Maks</span><span>Contoh {rp(sug ? Math.round(sug.avgBasket / 1000) * 1000 : 150000)}</span><span /></div>
        {tiers.map((t) => {
          const ex = sug ? Math.round(sug.avgBasket / 1000) * 1000 : 150000;
          return (
            <div key={t.id} className={`rv-row ${t.active === false ? 'off' : ''}`} role="row" data-testid="tier-row">
              <label className="check rv-a"><input type="checkbox" checked={t.active !== false} onChange={(e) => upd(t.id, { active: e.target.checked })} aria-label={`Aktif: ${t.label}`} /></label>
              <input className="rv-n" value={t.label} onChange={(e) => upd(t.id, { label: e.target.value })} aria-label="Nama kolom diskon" placeholder="mis. Ulasan + foto" />
              <div className="rv-j">
                <Seg value={t.type} onChange={(type) => upd(t.id, { type, value: type === t.type ? t.value : type === 'persen' ? 5 : 5000, max: type === 'persen' ? t.max || 15000 : undefined })}
                  options={[{ value: 'rp', label: 'Rp' }, { value: 'persen', label: '%' }]} />
              </div>
              <div className="rv-v">
                {t.type === 'rp'
                  ? <MoneyInput value={t.value} onChange={(value) => upd(t.id, { value })} ariaLabel={`Nilai ${t.label}`} />
                  : <div className="money pct"><input type="number" min={0} max={100} step={0.5} value={t.value} onChange={(e) => upd(t.id, { value: Math.max(0, Math.min(100, Number(e.target.value))) })} aria-label={`Persen ${t.label}`} /><span>%</span></div>}
              </div>
              <div className={`rv-m ${t.type === 'persen' ? '' : 'none'}`}>
                {t.type === 'persen' ? <MoneyInput value={t.max || 0} onChange={(max) => upd(t.id, { max })} ariaLabel={`Maksimal ${t.label}`} /> : <span className="muted">–</span>}
              </div>
              <span className="rv-ex"><span className="rv-ex-l">Contoh {rp(ex)}: </span>−{rp(tierAmount(t, ex))}</span>
              <button className="icon-btn rv-x" onClick={() => setTiers(tiers.filter((x) => x.id !== t.id))} aria-label={`Hapus kolom ${t.label}`}><Icon name="close" size={18} /></button>
            </div>
          );
        })}
      </div>
      <button className="btn rv-add" onClick={() => setTiers([...tiers, { id: `rt-${Date.now().toString(36)}`, label: `Kolom ${tiers.length + 1}`, type: 'rp', value: 5000 }])} data-testid="tambah-kolom-diskon">
        <Icon name="plus" size={18} />Tambah kolom diskon
      </button>

      <div className="calc" data-testid="review-saran">
        {sug ? (
          <>
            <b>Saran budget dari data {sug.months} bulan terakhir</b><br />
            {num(sug.trx)} transaksi ÷ {sug.months} bulan = {f1(sug.perMonth)} transaksi/bulan<br />
            {f1(sug.perMonth)} ÷ pop-up tiap {E.every_n} transaksi = {f1(sug.offers)} tawaran/bulan<br />
            {f1(sug.offers)} × {Math.round(REVIEW_ACCEPT_RATE * 100)}% mau mengulas × rata-rata diskon {rp(Math.round(sug.avgDisc))} = {rp(Math.round(sug.raw))} → dibulatkan ke atas <b>{rp(sug.budget)}</b>/bulan
            {budget !== sug.budget && sug.budget > 0 && <><br /><button className="linkish small" onClick={() => setE({ review_budget: sug.budget })} data-testid="pakai-saran">Pakai saran {rp(sug.budget)}</button></>}
          </>
        ) : yearOrders === undefined ? <>Menghitung saran budget…</> : <>Saran budget muncul setelah ada data transaksi bulan sebelumnya.</>}
        {budget > 0 && avgFix > 0 && <><br />Budget {rp(budget)} ÷ rata-rata diskon {rp(Math.round(avgFix))} ≈ {num(Math.floor(budget / avgFix))} ulasan per bulan.</>}
      </div>
    </section>
  );
}

/** Pengaturan khusus owner: poin loyalitas, pop-up ulasan & survei, tarif ongkir, daftar perangkai. */
function PromoTab() {
  const st = useLiveQuery(() => db.settings.get('toko'));
  const [c, setC] = useState<ReturnType<typeof storeCfg> | null>(null);
  useEffect(() => { if (st && !c) setC(storeCfg(st)); }, [st]); // eslint-disable-line
  if (!c) return null;
  const L = c.loyalty, E = c.engage, D = c.delivery;
  const setL = (p: Partial<typeof L>) => setC({ ...c, loyalty: { ...L, ...p } });
  const setE = (p: Partial<typeof E>) => setC({ ...c, engage: { ...E, ...p } });
  const setD = (p: Partial<typeof D>) => setC({ ...c, delivery: { ...D, ...p } });
  async function saveAll() {
    // bank survei diambil dari data terbaru agar perubahan di tab Survei tidak tertimpa
    await save<Settings>('settings', 'toko', { loyalty: c!.loyalty, engagement: { ...c!.engage, survey: storeCfg(st).engage.survey, per_popup: storeCfg(st).engage.per_popup }, delivery: c!.delivery });
    toast('Pengaturan promo, poin, dan ongkir disimpan');
  }
  const numIn = (v: number, on: (n: number) => void, label: string) => <input type="number" min={0} value={v} onChange={(e) => on(Number(e.target.value))} aria-label={label} />;
  return (
    <div className="stack">
      <div className="two">
        <section className="card">
          <h3>Poin loyalitas</h3>
          <label className="check"><input type="checkbox" checked={L.enabled} onChange={(e) => setL({ enabled: e.target.checked })} />Aktifkan poin</label>
          <div className="cols">
            <Field label="Setiap belanja (Rp)"><MoneyInput value={L.earn_per} onChange={(earn_per) => setL({ earn_per })} /></Field>
            <Field label="Dapat poin">{numIn(L.earn_points, (earn_points) => setL({ earn_points }), 'Poin didapat')}</Field>
          </div>
          <div className="cols">
            <Field label="Nilai 1 poin (Rp)"><MoneyInput value={L.point_value} onChange={(point_value) => setL({ point_value })} /></Field>
            <Field label="Minimal tukar (poin)">{numIn(L.min_redeem, (min_redeem) => setL({ min_redeem }), 'Minimal tukar')}</Field>
          </div>
          <div className="cols">
            <Field label="Silver: belanja 12 bulan ≥"><MoneyInput value={L.tier_silver} onChange={(tier_silver) => setL({ tier_silver })} /></Field>
            <Field label="Gold: belanja 12 bulan ≥"><MoneyInput value={L.tier_gold} onChange={(tier_gold) => setL({ tier_gold })} /></Field>
          </div>
          <p className="calc">Contoh: belanja {rp(250000)} → ⌊250.000 ÷ {num(L.earn_per)}⌋ × {L.earn_points} = {Math.floor(250000 / Math.max(1, L.earn_per)) * L.earn_points} poin, bernilai {rp(Math.floor(250000 / Math.max(1, L.earn_per)) * L.earn_points * L.point_value)} ({((L.earn_points * L.point_value) / Math.max(1, L.earn_per) * 100).toLocaleString('id-ID', { maximumFractionDigits: 2 })}% kembali).</p>
        </section>
        <section className="card">
          <h3>Pop-up ulasan Google Maps & survei</h3>
          <label className="check"><input type="checkbox" checked={E.enabled} onChange={(e) => setE({ enabled: e.target.checked })} />Tampilkan di layar kasir</label>
          <Field label="Muncul setiap … transaksi (per perangkat)">{numIn(E.every_n, (every_n) => setE({ every_n: Math.max(1, every_n) }), 'Frekuensi pop-up')}</Field>
          <Field label="Link ulasan Google Maps toko" hint="Google Maps › profil toko › Bagikan › salin link, atau link “Minta ulasan” dari Google Business"><input value={E.review_url} onChange={(e) => setE({ review_url: e.target.value.trim() })} placeholder="https://g.page/r/…/review" /></Field>
          <p className="calc">Survei: {storeCfg(st).engage.survey.filter((q) => q.active !== false).length} pertanyaan aktif, {storeCfg(st).engage.per_popup} diacak per pop-up. Atur pertanyaan di tab <b>Survei</b>.</p>
        </section>
      </div>
      <ReviewDiscountCard E={E} setE={setE} />
      <div className="two">
        <section className="card">
          <h3>Ongkir</h3>
          <div className="cols">
            <Field label="Tarif per km"><MoneyInput value={D.rate} onChange={(rate) => setD({ rate })} /></Field>
            <Field label="Ongkir minimum"><MoneyInput value={D.min} onChange={(min) => setD({ min })} /></Field>
          </div>
          <Field label="Pembulatan ke atas (Rp)">{numIn(D.round, (round) => setD({ round: Math.max(1, round) }), 'Pembulatan')}</Field>
          <p className="calc">Ongkir = maks({rp(D.min)}, km × {rp(D.rate)}, dibulatkan ke atas {rp(D.round)}). km = jarak rute jalan kendaraan, dibulatkan ke atas 0,1 km.</p>
        </section>
        <RouteKeyCard />
      </div>
      <button className="btn primary big" onClick={saveAll} data-testid="simpan-promo">Simpan pengaturan</button>
    </div>
  );
}

const fmtDob = (d?: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-');

/** Owner: email pribadi, No HP, tanggal lahir pengguna. Dipakai sebagai verifikasi reset sandi mandiri; tidak ikut sinkron. */
function PersonalModal({ u, onClose, onSave }: { u: UserRow; onClose: () => void; onSave: (body: { email: string; phone: string; birth_date: string }) => Promise<void> }) {
  const [v, setV] = useState({ email: u.email || '', phone: u.phone || '', birth_date: u.birth_date || '' });
  return (
    <Modal title={`Data pribadi ${u.name}`} onClose={onClose}
      footer={<button className="btn primary grow" onClick={() => onSave(v)} data-testid="simpan-data-pribadi">Simpan</button>}>
      <div className="stack">
        <Field label="Email pribadi"><input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} autoCapitalize="none" aria-label="Email pribadi" /></Field>
        <Field label="No HP"><input value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} inputMode="tel" placeholder="08…" aria-label="No HP" /></Field>
        <Field label="Tanggal lahir"><input type="date" value={v.birth_date} onChange={(e) => setV({ ...v, birth_date: e.target.value })} aria-label="Tanggal lahir" /></Field>
        <p className="muted small">{u.role === 'owner' ? 'Email owner menerima kode “Lupa kata sandi?” dan kalender event.' : 'Ketiganya dipakai sebagai verifikasi saat pengguna ini memakai menu Reset Password di Pengaturan akunnya; sandi baru dikirim ke email pribadi ini.'} Data hanya tersimpan di server, tidak dikirim ke perangkat lain.</p>
      </div>
    </Modal>
  );
}

/** Kasir & perangkai: reset sandi sendiri. Verifikasi email pribadi + No HP + tanggal lahir; sandi baru dikirim ke email. */
function SelfResetTab() {
  const s = useSession();
  const [v, setV] = useState({ email: '', phone: '', birth_date: '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  async function submit() {
    setBusy(true);
    try {
      const r = await api<{ to: string }>('/api/auth/self-reset', { body: v });
      setDone(r.to);
      setV({ email: '', phone: '', birth_date: '' });
      toast(`Sandi baru dikirim ke ${r.to}`);
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  }
  return (
    <section className="card narrow" data-testid="reset-mandiri">
      <h3>Reset password akun {s.user?.name}</h3>
      <p className="muted small">Isi data pribadi Anda sesuai yang dicatat owner. Bila cocok, sistem membuat kata sandi baru dan langsung mengirimnya ke email pribadi Anda. Perangkat ini tetap masuk; sandi baru dipakai saat masuk berikutnya.</p>
      <Field label="Email pribadi"><input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} autoCapitalize="none" autoComplete="off" aria-label="Email pribadi" /></Field>
      <Field label="No HP"><input value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} inputMode="tel" autoComplete="off" placeholder="08…" aria-label="No HP" /></Field>
      <Field label="Tanggal lahir"><input type="date" value={v.birth_date} onChange={(e) => setV({ ...v, birth_date: e.target.value })} aria-label="Tanggal lahir" /></Field>
      <button className="btn primary" disabled={busy || !v.email || !v.phone || !v.birth_date} onClick={submit} data-testid="kirim-reset-mandiri">{busy ? 'Memeriksa…' : 'Reset & kirim sandi baru ke email'}</button>
      {done && <div className="note" data-testid="reset-terkirim">Sandi baru sudah dikirim ke <b>{done}</b>. Periksa juga folder Spam.</div>}
      <p className="muted small">5 kali data salah = dikunci 15 menit. Bila data belum dicatat, minta owner mengisinya di Pengaturan › Pengguna › Data.</p>
    </section>
  );
}

interface UserRow { id: string; username: string; name: string; email?: string | null; phone?: string | null; birth_date?: string | null; role: Role; active: number; outlet_id?: string | null; can_view?: boolean }
function UsersTab() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [f, setF] = useState({ name: '', username: '', password: '', email: '', phone: '', birth_date: '', role: 'kasir' as Role, outlet_id: 'outlet-utama' });
  const [personal, setPersonal] = useState<UserRow | null>(null);
  const outlets = useLiveQuery(() => db.outlets.toArray(), []) || [];
  const [shown, setShown] = useState<Record<string, string>>({});
  const load = () => api<{ users: UserRow[] }>('/api/users').then((r) => setUsers(r.users)).catch((e) => toast(e.message, 'err'));
  async function reveal(u: UserRow) {
    if (shown[u.id] !== undefined) { const { [u.id]: _, ...rest } = shown; setShown(rest); return; }
    try { const r = await api<{ password: string }>(`/api/users/${u.id}/password`); setShown({ ...shown, [u.id]: r.password }); }
    catch (e) { toast((e as Error).message, 'err'); }
  }
  useEffect(() => { load(); }, []);
  async function add() {
    try { await api('/api/users', { body: f }); toast('Pengguna dibuat'); setF({ name: '', username: '', password: '', email: '', phone: '', birth_date: '', role: 'kasir', outlet_id: f.outlet_id }); load(); } catch (e) { toast((e as Error).message, 'err'); }
  }
  async function patch(id: string, body: object) {
    try { await api(`/api/users/${id}`, { method: 'PATCH', body }); load(); toast('Disimpan'); return true; } catch (e) { toast((e as Error).message, 'err'); return false; }
  }
  return (
    <div className="stack">
      <section className="card">
        <h3>Pengguna</h3>
        <div className="ulist">
          <div className="uhead"><span>Nama</span><span>Peran</span><span>Cabang</span><span /></div>
          {users.map((u) => (
            <div key={u.id} className={`urow ${u.active ? '' : 'off'}`} data-testid="user-row">
              <div className="uwho">
                <span className="avatar">{u.name.replace(/[^\p{L}\s]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}</span>
                <div className="grow"><b>{u.name}</b>{!u.active && <Badge tone="red">nonaktif</Badge>}<div className="muted">@{u.username} · {u.email || <span className="red">tanpa email</span>}{u.role !== 'owner' && (u.phone && u.birth_date ? ` · HP ${u.phone} · lahir ${fmtDob(u.birth_date)}` : <span className="red"> · data reset sandi belum lengkap</span>)}</div>
                  {shown[u.id] !== undefined && (
                    <div className="pwshow" data-testid="sandi-terlihat">Sandi <code>{shown[u.id]}</code>
                      <button className="linkish small" onClick={() => { navigator.clipboard?.writeText(shown[u.id]).then(() => toast('Sandi disalin')).catch(() => toast('Salin manual dari layar', 'err')); }}>Salin</button></div>
                  )}</div>
              </div>
              <select value={u.role} onChange={(e) => patch(u.id, { role: e.target.value })} aria-label={`Peran ${u.name}`}><option value="owner">Owner</option><option value="kasir">Admin</option><option value="perangkai">Perangkai</option></select>
              <select value={u.outlet_id || 'outlet-utama'} onChange={(e) => patch(u.id, { outlet_id: e.target.value })} aria-label={`Cabang ${u.name}`}>{outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
              <div className="uact">
                <button className="btn small ghost" onClick={() => setPersonal(u)} aria-label={`Data pribadi ${u.name}`} data-testid="data-pribadi">Data</button>
                <button className="btn small ghost" onClick={() => reveal(u)} title={u.can_view ? 'Lihat sandi' : 'Sandi dipilih sendiri oleh pengguna: atur ulang lewat Sandi agar bisa dilihat'} data-testid="lihat-sandi"
                  aria-label={`${shown[u.id] !== undefined ? 'Sembunyikan' : 'Lihat'} sandi ${u.name}`}><Icon name={shown[u.id] !== undefined ? 'eyeoff' : 'eye'} size={16} />{shown[u.id] !== undefined ? 'Tutup' : 'Lihat'}</button>
                <button className="btn small ghost" onClick={() => { const pw = prompt(`Kata sandi baru untuk ${u.name} (min. 6)`); if (pw) { patch(u.id, { password: pw }); const { [u.id]: _, ...rest } = shown; setShown(rest); } }}>Sandi</button>
                <button className={`btn small ${u.active ? 'ghost danger' : 'primary'}`} onClick={() => patch(u.id, { active: !u.active })}>{u.active ? 'Nonaktifkan' : 'Aktifkan'}</button>
              </div>
            </div>
          ))}
        </div>
        <p className="muted small"><b>Lihat</b> menampilkan sandi yang diatur owner (saat membuat pengguna atau lewat tombol Sandi). Sandi yang diganti pengguna sendiri lewat “Lupa kata sandi?” tidak disimpan, jadi tidak bisa dilihat; atur ulang lewat Sandi bila perlu.</p>
        <p className="muted small">Peran: <b>Owner</b> semua menu termasuk laporan dan pengaturan promo; <b>Admin</b> kasir, pesanan, pelanggan, shift; <b>Perangkai</b> papan produksi. Cabang menentukan stok dan laporan saat pengguna masuk.</p>
      </section>
      <section className="card">
        <h3>Tambah pengguna</h3>
        <div className="formgrid">
          <Field label="Nama"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Username"><input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase() })} autoCapitalize="none" autoComplete="off" name="kb-new-username" data-lpignore="true" /></Field>
          <Field label="Email pribadi (untuk reset kata sandi)"><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoCapitalize="none" autoComplete="off" /></Field>
          <Field label="No HP"><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} inputMode="tel" autoComplete="off" placeholder="08…" /></Field>
          <Field label="Tanggal lahir"><input type="date" value={f.birth_date} onChange={(e) => setF({ ...f, birth_date: e.target.value })} /></Field>
          <Field label="Kata sandi (min. 6)"><input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" name="kb-new-password" /></Field>
          <Field group label="Peran"><Seg value={f.role} onChange={(role) => setF({ ...f, role })} options={[{ value: 'kasir', label: 'Admin' }, { value: 'perangkai', label: 'Perangkai' }, { value: 'owner', label: 'Owner' }]} /></Field>
          <Field label="Cabang"><select value={f.outlet_id} onChange={(e) => setF({ ...f, outlet_id: e.target.value })}>{outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
        </div>
        <button className="btn primary" style={{ alignSelf: 'flex-start' }} disabled={!f.name || !f.username || f.password.length < 6} onClick={add}>Tambah pengguna</button>
      </section>
      {personal && <PersonalModal u={personal} onClose={() => setPersonal(null)} onSave={async (body) => { if (await patch(personal.id, body)) setPersonal(null); }} />}
    </div>
  );
}

function ImportTab() {
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [stockOpt, setStockOpt] = useState(false);
  const [raw, setRaw] = useState<any>(null);
  const [prog, setProg] = useState<[number, number] | null>(null);
  async function build(data: any, importStock: boolean) {
    const cfg = await getDeviceConfig();
    setPlan(await planImport(data, cfg.outletId, { importStock }));
  }
  return (
    <section className="card narrow">
      <h3>Pindahkan data dari Kasir Pintar</h3>
      <ol className="small">
        <li>Buka back office Kasir Pintar di Chrome komputer dan login.</li>
        <li>Tekan F12 › tab Console, tempel isi berkas <code>tools/ekspor-kasirpintar.js</code>, tekan Enter.</li>
        <li>Tunggu sampai berkas <code>kasirpintar-ekspor.json</code> terunduh, lalu pilih berkas itu di bawah.</li>
      </ol>
      <input type="file" accept=".json,application/json" onChange={async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try { const data = JSON.parse(await file.text()); setRaw(data); await build(data, stockOpt); } catch (err) { toast('Berkas tidak valid: ' + (err as Error).message, 'err'); }
      }} />
      <label className="check"><input type="checkbox" checked={stockOpt} onChange={async (e) => { setStockOpt(e.target.checked); if (raw) await build(raw, e.target.checked); }} /> Impor stok awal (aktifkan lacak stok untuk produk yang stoknya tidak nol)</label>
      {plan && (
        <div className="stack">
          <div className="row"><span>Kategori baru</span><b>{plan.categories}</b></div>
          <div className="row"><span>Produk</span><b>{plan.products}</b></div>
          <div className="row"><span>Pelanggan</span><b>{plan.customers}</b></div>
          <div className="row"><span>Transaksi</span><b>{plan.orders}</b></div>
          <div className="row"><span>Pembayaran</span><b>{plan.payments}</b></div>
          {plan.skipped > 0 && <div className="row"><span>Baris kosong dilewati (tanpa ID, kode, dan nama)</span><b>{plan.skipped}</b></div>}
          <button className="btn primary" disabled={!!prog && prog[0] < prog[1]} onClick={async () => { await runImport(plan, (a, b) => setProg([a, b])); toast('Impor selesai, sedang dikirim ke server'); }}>Impor sekarang</button>
          {prog && <div className="progress"><i style={{ width: `${(prog[0] / prog[1]) * 100}%` }} /><span>{prog[0]} / {prog[1]}</span></div>}
          <p className="muted small">Impor ulang aman: data dengan ID yang sama akan diperbarui, bukan digandakan.</p>
        </div>
      )}
    </section>
  );
}


interface EmailCfg { host?: string; port?: number; user?: string; from?: string; fromName?: string; hasPassword?: boolean; configured: boolean; passLen?: number }
function EmailTab() {
  const [cfg, setCfg] = useState<EmailCfg | null>(null);
  const [f, setF] = useState({ host: 'smtp.gmail.com', port: 465, user: '', pass: '', fromName: '' });
  const [testTo, setTestTo] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => api<EmailCfg>('/api/email-config').then((c) => {
    setCfg(c);
    if (c.configured) setF({ host: c.host || '', port: c.port || 465, user: c.user || '', pass: '', fromName: c.fromName || '' });
  }).catch((e) => toast(e.message, 'err'));
  useEffect(() => { load(); }, []);
  async function saveCfg() {
    setBusy(true);
    try { setCfg(await api<EmailCfg>('/api/email-config', { body: { ...f, from: f.user } })); setF({ ...f, pass: '' }); toast('Email Reset disimpan'); }
    catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  }
  async function test() {
    setBusy(true);
    try {
      // uji memakai isian yang sedang tampil, jadi Pass Email Toko yang baru diketik ikut diuji walau belum disimpan
      const r = await api<{ to: string; via: 'manual' | 'owner' | 'toko' }>('/api/email-config/test', { body: { to: testTo, host: f.host, port: f.port, user: f.user, pass: f.pass, fromName: f.fromName }, timeout: 40000 });
      toast(`Tes Email terkirim ke ${r.to}${r.via === 'toko' ? ' (Akun GMAIL Toko sendiri, karena akun owner belum punya email)' : ''}.${f.pass ? ' Tekan Simpan agar Pass Email Toko ini dipakai.' : ''}`);
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  }
  const gmail = /gmail\.com$|googlemail\.com$/i.test(f.host.trim());
  const letters = f.pass.replace(/[^A-Za-z]/g, '').length;
  if (!cfg) return null;
  return (
    <div className="two">
      <section className="card">
        <h3>Email Reset</h3>
        <div className="row"><span>Status</span><b className={cfg.configured ? 'ok' : 'red'}>{cfg.configured ? 'Aktif' : 'Belum diatur'}</b></div>
        <Field label="Akun GMAIL Toko"><input type="email" value={f.user} onChange={(e) => setF({ ...f, user: e.target.value.trim() })} autoCapitalize="none" placeholder="tokoanda@gmail.com" /></Field>
        <Field label="Pass Email Toko" hint={f.pass
          ? (gmail ? <span className={letters === 16 ? 'ok' : 'red'} data-testid="pass-hitung">{letters}/16 huruf App Password{letters === 16 ? '' : ' (sandi Gmail biasa akan ditolak Google)'}</span> : undefined)
          : cfg.hasPassword ? <span className={gmail && cfg.passLen !== 16 ? 'red' : ''}>Sudah tersimpan ({cfg.passLen} karakter){gmail && cfg.passLen !== 16 ? ': bukan App Password 16 huruf, ketik ulang lalu Simpan.' : '. Kosongkan bila tidak diganti.'}</span> : undefined}>
          <input type="password" value={f.pass} onChange={(e) => setF({ ...f, pass: e.target.value })} autoComplete="new-password" placeholder="xxxx xxxx xxxx xxxx" />
        </Field>
        <Field label="Nama pengirim"><input value={f.fromName} onChange={(e) => setF({ ...f, fromName: e.target.value })} placeholder="Buket Stabat" /></Field>
        <div className="cols">
          <Field label="Server SMTP"><input value={f.host} onChange={(e) => setF({ ...f, host: e.target.value.trim() })} /></Field>
          <Field label="Port"><input type="number" value={f.port} onChange={(e) => setF({ ...f, port: Number(e.target.value) })} /></Field>
        </div>
        <button className="btn primary" disabled={busy || !f.user || !f.host || (!f.pass && !cfg.hasPassword)} onClick={saveCfg}>Simpan</button>
        <h3>Tes Email</h3>
        <Field label="Kirim ke" hint="Kosongkan untuk mengirim ke email akun owner. Bila owner belum punya email, dikirim ke Akun GMAIL Toko sendiri."><input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} autoCapitalize="none" /></Field>
        <button className="btn" disabled={busy || !f.user || !f.host || (!f.pass && !cfg.hasPassword)} onClick={test} data-testid="tes-email">{busy ? 'Memproses…' : 'Tes Email'}</button>
      </section>
      <section className="card">
        <h3>Cara membuat App password Gmail</h3>
        <ol className="small">
          <li>Pakai akun Gmail khusus toko bila ada.</li>
          <li>Aktifkan <b>Verifikasi 2 Langkah</b> di Akun Google › Keamanan.</li>
          <li>Buka <b>myaccount.google.com/apppasswords</b>, buat app password bernama “Kasir Buket”.</li>
          <li>Salin 16 huruf yang muncul ke kolom Pass Email Toko di samping, lalu Simpan dan Tes Email.</li>
        </ol>
        <p className="muted small">Akun GMAIL Toko ini juga dipakai untuk mengirim tugas ke perangkai dan kalender event ke owner. Pass Email Toko hanya tersimpan di server dan tidak pernah dikirim ke HP atau browser. Setiap pengguna perlu punya email di Pengaturan › Pengguna agar bisa memakai “Lupa kata sandi?”.</p>
        <p className="muted small">Server harus terhubung ke internet agar email terkirim. Bila Gmail menolak, cabut app password lama lalu buat yang baru.</p>
      </section>
    </div>
  );
}

/** Kunci OpenRouteService untuk jarak rute jalan (disimpan di server, tidak pernah dikirim balik utuh). */
function RouteKeyCard() {
  const [g, setG] = useState<{ hasOrsKey: boolean; keyHint: string } | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<{ hasOrsKey: boolean; keyHint: string }>('/api/geo-config').then(setG).catch((e) => toast(e.message, 'err')); }, []);
  async function saveKey(k: string) {
    setBusy(true);
    try { setG(await api('/api/geo-config', { body: { orsKey: k } })); setKey(''); toast(k ? 'Kunci OpenRouteService disimpan' : 'Kunci dihapus'); }
    catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  }
  async function test() {
    setBusy(true);
    try {
      const cfg = await getDeviceConfig();
      const o = await db.outlets.get(cfg.outletId);
      if (!o?.location) throw new Error('Simpan lokasi toko dulu di tab Toko & cabang');
      const r = await api<{ km: number; source: string; minutes?: number }>('/api/geo-config/test', { body: { from: o.location }, timeout: 25000 });
      toast(`Rute uji ${r.km.toLocaleString('id-ID')} km lewat ${r.source === 'ors' ? 'OpenRouteService' : 'OSRM (cadangan)'}`);
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  }
  return (
    <section className="card">
      <h3>Rute jalan kendaraan</h3>
      <dl className="dl">
        <dt>Penyedia utama</dt><dd>OpenRouteService (profil mobil) {g?.hasOrsKey ? <Badge tone="green">kunci {g.keyHint}</Badge> : <Badge tone="amber">belum ada kunci</Badge>}</dd>
        <dt>Cadangan</dt><dd>OSRM (server demo OpenStreetMap)</dd>
        <dt>Bila keduanya gagal</dt><dd>Kasir mengisi km manual. Tidak ada perkiraan garis lurus.</dd>
      </dl>
      <Field label="API key OpenRouteService" hint={g?.hasOrsKey ? 'Kosongkan bila tidak diganti.' : 'Gratis: 2.000 rute/hari, 40/menit.'}>
        <input type="password" value={key} onChange={(e) => setKey(e.target.value.trim())} autoComplete="off" placeholder="eyJvcmciOi…" data-testid="ors-key" />
      </Field>
      <div className="btns">
        <button className="btn primary" disabled={busy || !key} onClick={() => saveKey(key)}>Simpan kunci</button>
        <button className="btn" disabled={busy} onClick={test}>Uji rute</button>
        {g?.hasOrsKey && <button className="btn ghost danger" disabled={busy} onClick={() => saveKey('')}>Hapus kunci</button>}
      </div>
      <ol className="small muted">
        <li>Daftar gratis di <b>account.heigit.org</b> (penyedia OpenRouteService).</li>
        <li>Buat API key baru, salin, tempel di atas, lalu Simpan dan Uji rute.</li>
      </ol>
    </section>
  );
}

interface NotifyJob { id: number; order_id: string; email: string; florist: string; label: string; kind: 'request' | 'cancel'; seq: number; status: 'pending' | 'sent' | 'failed' | 'expired'; attempts: number; last_error?: string | null; created_at: string; sent_at?: string | null }
interface NotifyView { enabled: boolean; leadMinutes: number; contacts: { name: string; email: string }[]; smtp: { configured: boolean; from: string | null }; jobs: NotifyJob[] }
const JOB_STATUS: Record<NotifyJob['status'], [string, 'green' | 'amber' | 'red' | 'gray']> = { sent: ['Terkirim', 'green'], pending: ['Menunggu', 'amber'], failed: ['Gagal', 'red'], expired: ['Kedaluwarsa', 'gray'] };

/** Daftar perangkai + email Google mereka untuk notifikasi Tugas di Google Calendar. */
function FloristTab() {
  const st = useLiveQuery(() => db.settings.get('toko'));
  const [nv, setNv] = useState<NotifyView | null>(null);
  const [rows, setRows] = useState<{ name: string; email: string }[] | null>(null);
  const [opt, setOpt] = useState({ enabled: true, leadMinutes: 60 });
  const [busy, setBusy] = useState('');
  const load = () => api<NotifyView>('/api/notify').then(setNv).catch((e) => toast(e.message, 'err'));
  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (!st || !nv || rows) return;
    const email = (n: string) => nv.contacts.find((c) => c.name.trim().toLowerCase() === n.trim().toLowerCase())?.email || '';
    setRows(storeCfg(st).florists.map((name) => ({ name, email: email(name) })));
    setOpt({ enabled: nv.enabled, leadMinutes: nv.leadMinutes });
  }, [st, nv]); // eslint-disable-line
  if (!rows || !nv) return null;
  const setRow = (i: number, p: Partial<{ name: string; email: string }>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  async function saveAll() {
    setBusy('save');
    try {
      const clean = rows!.map((r) => ({ name: r.name.trim(), email: r.email.trim() })).filter((r) => r.name);
      setNv(await api<NotifyView>('/api/notify', { body: { ...opt, contacts: clean } }));
      await save<Settings>('settings', 'toko', { florists: clean.map((r) => r.name) });
      setRows(clean);
      toast('Perangkai & notifikasi disimpan');
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(''); }
  }
  async function test(name: string, cancel: boolean) {
    setBusy(name);
    try { const r = await api<{ email: string }>('/api/notify/test', { body: { name, cancel }, timeout: 40000 }); toast(cancel ? `Pembatalan Tugas uji dikirim ke ${r.email}` : `Tugas uji dikirim ke ${r.email}. Cek Google Calendar besok 09.00.`); }
    catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(''); }
  }
  const saved = (n: string) => nv.contacts.some((c) => c.name.trim().toLowerCase() === n.trim().toLowerCase());
  return (
    <div className="stack">
      <div className="split even">
        <section className="card">
          <h3>Daftar perangkai</h3>
          <div className="flist">
            <div className="fhead"><span>Nama</span><span>Gmail perangkai</span><span /></div>
            {rows.map((r, i) => (
              <div key={i} className="frow" data-testid="florist-row">
                <input value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} aria-label={`Nama perangkai ${i + 1}`} />
                <input type="email" value={r.email} onChange={(e) => setRow(i, { email: e.target.value.trim() })} placeholder="nama@gmail.com" autoCapitalize="none" aria-label={`Email ${r.name || 'perangkai'}`} />
                <div className="uact">
                  <button className="btn small ghost" disabled={!!busy || !saved(r.name) || !nv.smtp.configured} onClick={() => test(r.name, false)} title="Kirim Tugas uji">Uji</button>
                  <button className="btn small ghost" disabled={!!busy || !saved(r.name) || !nv.smtp.configured} onClick={() => test(r.name, true)} title="Batalkan Tugas uji">Batalkan uji</button>
                  <button className="icon-btn" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={`Hapus ${r.name}`}><Icon name="close" size={18} /></button>
                </div>
              </div>
            ))}
          </div>
          <button className="btn small" onClick={() => setRows([...rows, { name: '', email: '' }])}><Icon name="plus" size={16} />Perangkai</button>
          <p className="muted small">Nama tampil di pilihan perangkai saat checkout dan di tiket produksi. Email hanya tersimpan di server, tidak ikut ke HP kasir.</p>
        </section>
        <section className="card">
          <h3>Notifikasi tugas & Google Calendar</h3>
          <label className="check"><input type="checkbox" checked={opt.enabled} onChange={(e) => setOpt({ ...opt, enabled: e.target.checked })} data-testid="notif-aktif" />Kirim otomatis saat perangkai ditunjuk</label>
          <Field label="Durasi rangkai di kalender (menit sebelum jadwal ambil/antar)"><input type="number" min={15} max={1440} step={15} value={opt.leadMinutes} onChange={(e) => setOpt({ ...opt, leadMinutes: Number(e.target.value) })} aria-label="Durasi rangkai" /></Field>
          <dl className="dl">
            <dt>Pengirim</dt><dd>{nv.smtp.configured ? nv.smtp.from : <span className="red">Belum diatur. Isi di tab Reset Password.</span>}</dd>
            <dt>Ditunjuk</dt><dd>Email + Tugas di Google Calendar perangkai (±15 detik setelah tersimpan).</dd>
            <dt>Jadwal/isi berubah</dt><dd>Tugas diperbarui.</dd>
            <dt>Dipindah / batal</dt><dd>Tugas dibatalkan, acara hilang dari kalender perangkai.</dd>
          </dl>
          <div className="note warn small">Sekali per perangkai: simpan alamat {nv.smtp.from || 'email toko'} di Kontak Google mereka, atau di Google Calendar › Setelan › Setelan acara › “Tambahkan undangan ke kalender saya” pilih “Dari semua orang”. Tanpa ini Google bisa menahan Tugas dari pengirim yang belum dikenal. Pakai tombol Uji lalu Batalkan uji untuk memastikan.</div>
        </section>
      </div>
      <button className="btn primary big" onClick={saveAll} disabled={busy === 'save'} data-testid="simpan-perangkai">Simpan perangkai & notifikasi</button>
      <section className="card">
        <h3>Riwayat notifikasi</h3>
        <div className="table flat" style={{ ['--cols' as string]: '130px 90px minmax(0,1fr) 130px 110px', ['--cols-sm' as string]: '70px minmax(0,1fr) auto' }}>
          <div className="thead"><div className="hide-sm">Waktu</div><div>Pesanan</div><div>Perangkai</div><div className="hide-sm">Jenis</div><div>Status</div></div>
          {nv.jobs.map((j) => (
            <div key={j.id} className="trow" data-testid="notif-row">
              <div className="muted hide-sm">{fmtShort(j.sent_at || j.created_at)}</div>
              <div><b>{j.label}</b></div>
              <div className="clip">{j.florist}<div className="muted clip">{j.email}{j.last_error ? ` · ${j.last_error}` : ''}</div></div>
              <div className="hide-sm">{j.kind === 'cancel' ? 'Pembatalan' : j.seq > 0 ? 'Pembaruan' : 'Tugas baru'}</div>
              <div><Badge tone={JOB_STATUS[j.status][1]}>{JOB_STATUS[j.status][0]}</Badge></div>
            </div>
          ))}
          {!nv.jobs.length && <Empty>Belum ada notifikasi.</Empty>}
        </div>
      </section>
    </div>
  );
}

/** Bank pertanyaan survei: pop-up kasir mengambil 1–2 pertanyaan aktif secara acak. */
function SurveyTab() {
  const st = useLiveQuery(() => db.settings.get('toko'));
  const answered = useLiveQuery(() => db.orders.filter((o) => !!o.survey && !o.void).toArray(), []) || [];
  const [edit, setEdit] = useState<SurveyQuestion | null>(null);
  const cfg = storeCfg(st).engage;
  const bank = cfg.survey;
  const stats = useMemo(() => {
    const m = new Map<string, { n: number; top: string }>();
    for (const q of bank) {
      const c = new Map<string, number>();
      for (const o of answered) { const a = answerOf(o.survey, q); if (a) c.set(a, (c.get(a) || 0) + 1); }
      const top = [...c.entries()].sort((x, y) => y[1] - x[1])[0];
      m.set(q.id, { n: [...c.values()].reduce((s, x) => s + x, 0), top: top ? `${top[0]} (${top[1]})` : '' });
    }
    return m;
  }, [bank, answered]);
  if (!st) return null;
  const persist = (survey: SurveyQuestion[], extra: Partial<EngageCfg> = {}) => save<Settings>('settings', 'toko', { engagement: { ...cfg, ...extra, survey } });
  const active = bank.filter((q) => q.active !== false).length;
  const missing = DEFAULT_SURVEY.filter((d) => !bank.some((q) => q.id === d.id));
  async function remove(q: SurveyQuestion) {
    const n = stats.get(q.id)?.n || 0;
    if (!confirm(`Hapus pertanyaan "${q.q}"?${n ? ` ${n} jawaban lama tetap tersimpan di transaksi, tetapi tidak tampil lagi di analisis.` : ''}`)) return;
    await persist(bank.filter((x) => x.id !== q.id));
  }
  return (
    <div className="stack" data-testid="survei">
      <div className="toolbar">
        <span className="muted"><b style={{ color: 'var(--ink)' }}>{bank.length} pertanyaan</b> · {active} aktif</span>
        <Field group label="Per pop-up"><Seg value={String(cfg.per_popup) as '1' | '2'} onChange={(v) => persist(bank, { per_popup: Number(v) })} options={[{ value: '1', label: '1 pertanyaan' }, { value: '2', label: '2 pertanyaan' }]} /></Field>
        <span className="grow" />
        {missing.length > 0 && <button className="btn" onClick={() => persist([...bank, ...missing])}>Pulihkan {missing.length} pertanyaan bawaan</button>}
        <button className="btn primary" onClick={() => setEdit({ id: '', q: '', options: [], active: true })} data-testid="tanya-baru"><Icon name="plus" size={18} />Pertanyaan</button>
      </div>
      <div className="qlist">
        {bank.map((q, i) => {
          const s = stats.get(q.id);
          return (
            <div key={q.id} className={`qrow ${q.active === false ? 'off' : ''}`} data-testid="survey-row">
              <label className="check" title={q.active === false ? 'Aktifkan' : 'Nonaktifkan'}><input type="checkbox" checked={q.active !== false} onChange={(e) => persist(bank.map((x) => (x.id === q.id ? { ...x, active: e.target.checked } : x)))} aria-label={`Aktif: ${q.q}`} /></label>
              <span className="qno">{i + 1}</span>
              <div className="qbody"><b>{q.q}</b><div className="qopts">{q.options.map((o) => <span key={o}>{o}</span>)}</div></div>
              <div className="qstat">{s?.n ? <><b>{num(s.n)}</b> jawaban<div className="muted">teratas: {s.top}</div></> : <span className="muted">belum ada jawaban</span>}</div>
              <div className="uact">
                <button className="btn small ghost" onClick={() => setEdit(q)}>Ubah</button>
                <button className="icon-btn" onClick={() => remove(q)} aria-label={`Hapus pertanyaan ${q.q}`}><Icon name="close" size={18} /></button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="muted small">Setiap kali pop-up muncul, {cfg.per_popup} pertanyaan aktif dipilih acak. Pertanyaan disimpan dengan kode tetap, jadi mengubah kalimat tidak menghapus hitungan jawaban. Rincian per jawaban ada di Laporan › Analisis penjualan.</p>
      {edit && <QuestionEditor q={edit} onClose={() => setEdit(null)} onSave={async (q) => {
        const next = q.id ? bank.map((x) => (x.id === q.id ? q : x)) : [...bank, { ...q, id: `q-${Date.now().toString(36)}` }];
        await persist(next);
        setEdit(null);
        toast('Pertanyaan disimpan');
      }} />}
    </div>
  );
}

function QuestionEditor({ q, onSave, onClose }: { q: SurveyQuestion; onSave: (q: SurveyQuestion) => void; onClose: () => void }) {
  const [text, setText] = useState(q.q);
  const [opts, setOpts] = useState(q.options.join('\n'));
  const [active, setActive] = useState(q.active !== false);
  const options = [...new Set(opts.split('\n').map((x) => x.trim()).filter(Boolean))];
  return (
    <Modal title={q.id ? 'Ubah pertanyaan' : 'Pertanyaan baru'} onClose={onClose}
      footer={<button className="btn primary grow" disabled={!text.trim() || options.length < 2} onClick={() => onSave({ id: q.id, q: text.trim(), options, active })} data-testid="simpan-tanya">Simpan</button>}>
      <div className="stack">
        <Field label="Pertanyaan"><input value={text} onChange={(e) => setText(e.target.value)} placeholder="Warna buket favorit?" data-testid="tanya-teks" /></Field>
        <Field label="Pilihan jawaban (satu per baris, minimal 2)" hint={`${options.length} pilihan`}><textarea rows={6} value={opts} onChange={(e) => setOpts(e.target.value)} placeholder={'Pink\nPutih\nMerah'} data-testid="tanya-opsi" /></Field>
        <label className="check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />Aktif (ikut diacak di pop-up)</label>
      </div>
    </Modal>
  );
}
