import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getMeta } from '../lib/db';
import { api, isNative, logout, useSession } from '../lib/session';
import { sync, useSyncStatus } from '../lib/sync';
import { getDeviceConfig, newId, save, setDeviceConfig, type DeviceConfig, type PrinterConfig, type PrinterMode } from '../lib/store';
import { sendToPrinter, ThermalPrinter } from '../lib/print';
import { buildTest } from '../lib/print/receipts';
import { planImport, runImport, type ImportPlan } from '../lib/kasirpintar';
import { Badge, Field, MoneyInput, Seg, toast } from '../components/ui';
import { Icon } from '../components/icons';
import { storeCfg } from '../lib/settings';
import { parseLocalInput } from '../lib/geo';
import { num, rp } from '../lib/format';
import type { Outlet, PrintTarget, Role, Settings } from '../lib/types';
import { fmtShort } from '../lib/format';

export default function Pengaturan() {
  const s = useSession();
  const owner = s.user?.role === 'owner';
  const [tab, setTab] = useState<'perangkat' | 'printer' | 'toko' | 'promo' | 'pengguna' | 'email' | 'impor'>('perangkat');
  const tabs = [
    { value: 'perangkat' as const, label: 'Perangkat' },
    { value: 'printer' as const, label: 'Printer' },
    ...(owner ? [{ value: 'toko' as const, label: 'Toko & cabang' }, { value: 'promo' as const, label: 'Promo, poin & ongkir' }, { value: 'pengguna' as const, label: 'Pengguna' }, { value: 'email' as const, label: 'Email' }, { value: 'impor' as const, label: 'Impor Kasir Pintar' }] : []),
  ];
  return (
    <div className="page">
      <div className="toolbar"><Seg value={tab} onChange={setTab} options={tabs} /></div>
      {tab === 'perangkat' && <DeviceTab />}
      {tab === 'printer' && <PrinterTab />}
      {tab === 'toko' && owner && <StoreTab />}
      {tab === 'pengguna' && owner && <UsersTab />}
      {tab === 'promo' && owner && <PromoTab />}
      {tab === 'email' && owner && <EmailTab />}
      {tab === 'impor' && owner && <ImportTab />}
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
  const errors = useLiveQuery(() => getMeta<any[]>('sync_errors', []), []) || [];
  const [cfg, setCfg] = useDeviceConfig();
  if (!cfg) return null;
  return (
    <div className="two">
      <section className="card">
        <h3>Perangkat ini</h3>
        <div className="row"><span>Kode perangkat (awalan nomor struk)</span><b>{s.device?.code}</b></div>
        <div className="row"><span>Nama</span><b>{s.device?.name}</b></div>
        <div className="row"><span>Pengguna</span><b>{s.user?.name} ({s.user?.role})</b></div>
        <div className="row"><span>Server</span><b className="break">{s.serverUrl}</b></div>
        <Field label="Cabang perangkat ini">
          <select value={cfg.outletId} onChange={(e) => setCfg({ ...cfg, outletId: e.target.value })}>
            {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </Field>
        <button className="btn danger" onClick={async () => { if (confirm('Keluar dari akun di perangkat ini? Data yang belum tersinkron tetap tersimpan.')) { sync.stop(); await logout(); } }}>Keluar</button>
      </section>
      <section className="card">
        <h3>Sinkronisasi otomatis</h3>
        <div className="row"><span>Status</span><b>{st.online ? (st.pending ? `${st.pending} perubahan menunggu` : 'Tersinkron') : 'Offline'}</b></div>
        <div className="row"><span>Terakhir</span><b>{st.lastSync ? new Date(st.lastSync).toLocaleTimeString('id-ID') : '-'}</b></div>
        <div className="row"><span>Nomor urut data server</span><b>{st.cursor}</b></div>
        <p className="muted small">Sinkron berjalan sendiri: saat aplikasi dibuka, setiap ada transaksi, saat perangkat lain mengubah data (realtime), dan saat internet kembali. Tidak perlu menekan tombol.</p>
        <button className="btn" onClick={() => sync.resync()}>Tarik ulang semua data</button>
        {errors.length > 0 && (
          <>
            <h3>Perubahan ditolak server</h3>
            {errors.slice(0, 10).map((e, i) => <div key={i} className="row small"><span>{fmtShort(e.at)} · {e.c}/{e.id}</span><span className="red">{e.error}</span></div>)}
          </>
        )}
      </section>
    </div>
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
    await save<Settings>('settings', 'toko', { loyalty: c!.loyalty, engagement: c!.engage, delivery: c!.delivery, florists: c!.florists.map((x) => x.trim()).filter(Boolean) });
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
          <div className="cols">
            <Field label="Diskon ulasan minimal"><MoneyInput value={E.review_discount_min} onChange={(review_discount_min) => setE({ review_discount_min })} /></Field>
            <Field label="Diskon ulasan maksimal"><MoneyInput value={E.review_discount_max} onChange={(review_discount_max) => setE({ review_discount_max })} /></Field>
          </div>
          {E.survey.slice(0, 2).map((q, i) => (
            <div key={i} className="box stack">
              <Field label={`Pertanyaan survei ${i + 1}`}><input value={q.q} onChange={(e) => setE({ survey: E.survey.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)) })} /></Field>
              <Field label="Pilihan jawaban (pisahkan koma)"><input value={q.options.join(', ')} onChange={(e) => setE({ survey: E.survey.map((x, j) => (j === i ? { ...x, options: e.target.value.split(',').map((o) => o.trim()).filter(Boolean) } : x)) })} /></Field>
            </div>
          ))}
          <p className="muted small">Jawaban survei tampil di Laporan › Analisis penjualan. Mengubah teks pertanyaan memulai hitungan baru untuk pertanyaan itu.</p>
        </section>
      </div>
      <div className="two">
        <section className="card">
          <h3>Ongkir</h3>
          <div className="cols">
            <Field label="Tarif per km"><MoneyInput value={D.rate} onChange={(rate) => setD({ rate })} /></Field>
            <Field label="Ongkir minimum"><MoneyInput value={D.min} onChange={(min) => setD({ min })} /></Field>
          </div>
          <Field label="Pembulatan ke atas (Rp)">{numIn(D.round, (round) => setD({ round: Math.max(1, round) }), 'Pembulatan')}</Field>
          <p className="calc">Ongkir = maks({rp(D.min)}, km × {rp(D.rate)}, dibulatkan ke atas {rp(D.round)}). Jarak memakai rute jalan dari OpenStreetMap; bila tidak tersedia, garis lurus × 1,3.</p>
        </section>
        <section className="card">
          <h3>Daftar perangkai</h3>
          {c.florists.map((n, i) => (
            <div key={i} className="row">
              <input value={n} onChange={(e) => setC({ ...c, florists: c.florists.map((x, j) => (j === i ? e.target.value : x)) })} aria-label={`Perangkai ${i + 1}`} />
              <button className="btn small danger" onClick={() => setC({ ...c, florists: c.florists.filter((_, j) => j !== i) })}>Hapus</button>
            </div>
          ))}
          <button className="btn small" onClick={() => setC({ ...c, florists: [...c.florists, ''] })}><Icon name="plus" size={16} />Perangkai</button>
        </section>
      </div>
      <button className="btn primary big" onClick={saveAll} data-testid="simpan-promo">Simpan pengaturan</button>
    </div>
  );
}

interface UserRow { id: string; username: string; name: string; email?: string | null; role: Role; active: number; outlet_id?: string | null }
function UsersTab() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [f, setF] = useState({ name: '', username: '', password: '', email: '', role: 'kasir' as Role, outlet_id: 'outlet-utama' });
  const outlets = useLiveQuery(() => db.outlets.toArray(), []) || [];
  const load = () => api<{ users: UserRow[] }>('/api/users').then((r) => setUsers(r.users)).catch((e) => toast(e.message, 'err'));
  useEffect(() => { load(); }, []);
  async function add() {
    try { await api('/api/users', { body: f }); toast('Pengguna dibuat'); setF({ name: '', username: '', password: '', email: '', role: 'kasir', outlet_id: f.outlet_id }); load(); } catch (e) { toast((e as Error).message, 'err'); }
  }
  async function patch(id: string, body: object) {
    try { await api(`/api/users/${id}`, { method: 'PATCH', body }); load(); toast('Disimpan'); } catch (e) { toast((e as Error).message, 'err'); }
  }
  return (
    <div className="two">
      <section className="card">
        <h3>Pengguna</h3>
        {users.map((u) => (
          <div key={u.id} className="row">
            <span><b>{u.name}</b> <span className="muted">@{u.username}{u.email ? ` · ${u.email}` : ' · tanpa email'}</span></span>
            <button className="btn small" onClick={() => { const em = prompt(`Email untuk ${u.name} (kosongkan untuk menghapus)`, u.email || ''); if (em !== null) patch(u.id, { email: em }); }}>Email</button>
            <select value={u.role} onChange={(e) => patch(u.id, { role: e.target.value })} aria-label="Peran" style={{ maxWidth: 130 }}><option value="owner">Owner</option><option value="kasir">Admin</option><option value="perangkai">Perangkai</option></select>
            <select value={u.outlet_id || 'outlet-utama'} onChange={(e) => patch(u.id, { outlet_id: e.target.value })} aria-label="Cabang" style={{ maxWidth: 160 }}>{outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
            <button className="btn small" onClick={() => { const pw = prompt(`Kata sandi baru untuk ${u.name} (min. 6)`); if (pw) patch(u.id, { password: pw }); }}>Sandi</button>
            <button className={`btn small ${u.active ? '' : 'primary'}`} onClick={() => patch(u.id, { active: !u.active })}>{u.active ? 'Nonaktifkan' : 'Aktifkan'}</button>
          </div>
        ))}
        <p className="muted small">Peran: <b>Owner</b> semua menu termasuk laporan dan pengaturan promo; <b>Admin</b> kasir, pesanan, pelanggan, shift; <b>Perangkai</b> papan produksi. Cabang menentukan stok dan laporan saat pengguna masuk.</p>
      </section>
      <section className="card">
        <h3>Tambah pengguna</h3>
        <Field label="Nama"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Username"><input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase() })} autoCapitalize="none" /></Field>
        <Field label="Email (untuk reset kata sandi)"><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoCapitalize="none" /></Field>
        <Field label="Kata sandi (min. 6)"><input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        <Field group label="Peran"><Seg value={f.role} onChange={(role) => setF({ ...f, role })} options={[{ value: 'kasir', label: 'Admin' }, { value: 'perangkai', label: 'Perangkai' }, { value: 'owner', label: 'Owner' }]} /></Field>
        <Field label="Cabang"><select value={f.outlet_id} onChange={(e) => setF({ ...f, outlet_id: e.target.value })}>{outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
        <button className="btn primary" disabled={!f.name || !f.username || f.password.length < 6} onClick={add}>Tambah</button>
      </section>
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
          <button className="btn primary" disabled={!!prog && prog[0] < prog[1]} onClick={async () => { await runImport(plan, (a, b) => setProg([a, b])); toast('Impor selesai, sedang dikirim ke server'); }}>Impor sekarang</button>
          {prog && <div className="progress"><i style={{ width: `${(prog[0] / prog[1]) * 100}%` }} /><span>{prog[0]} / {prog[1]}</span></div>}
          <p className="muted small">Impor ulang aman: data dengan ID yang sama akan diperbarui, bukan digandakan.</p>
        </div>
      )}
    </section>
  );
}


interface EmailCfg { host?: string; port?: number; user?: string; from?: string; fromName?: string; hasPassword?: boolean; configured: boolean }
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
    try { setCfg(await api<EmailCfg>('/api/email-config', { body: { ...f, from: f.user } })); setF({ ...f, pass: '' }); toast('Pengaturan email disimpan'); }
    catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  }
  async function test() {
    setBusy(true);
    try { const r = await api<{ to: string }>('/api/email-config/test', { body: { to: testTo }, timeout: 40000 }); toast(`Email uji terkirim ke ${r.to}`); }
    catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  }
  if (!cfg) return null;
  return (
    <div className="two">
      <section className="card">
        <h3>Email pengirim (untuk kode reset kata sandi)</h3>
        <div className="row"><span>Status</span><b className={cfg.configured ? 'ok' : 'red'}>{cfg.configured ? 'Aktif' : 'Belum diatur'}</b></div>
        <Field label="Alamat Gmail pengirim"><input type="email" value={f.user} onChange={(e) => setF({ ...f, user: e.target.value.trim() })} autoCapitalize="none" placeholder="tokoanda@gmail.com" /></Field>
        <Field label="App password Gmail (16 huruf)" hint={cfg.hasPassword ? 'Sudah tersimpan. Kosongkan bila tidak diganti.' : undefined}>
          <input type="password" value={f.pass} onChange={(e) => setF({ ...f, pass: e.target.value })} autoComplete="new-password" placeholder="xxxx xxxx xxxx xxxx" />
        </Field>
        <Field label="Nama pengirim"><input value={f.fromName} onChange={(e) => setF({ ...f, fromName: e.target.value })} placeholder="Buket Stabat" /></Field>
        <div className="cols">
          <Field label="Server SMTP"><input value={f.host} onChange={(e) => setF({ ...f, host: e.target.value.trim() })} /></Field>
          <Field label="Port"><input type="number" value={f.port} onChange={(e) => setF({ ...f, port: Number(e.target.value) })} /></Field>
        </div>
        <button className="btn primary" disabled={busy || !f.user || !f.host || (!f.pass && !cfg.hasPassword)} onClick={saveCfg}>Simpan</button>
        <h3>Kirim email uji</h3>
        <Field label="Kirim ke" hint="Kosongkan untuk mengirim ke email akun owner"><input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} autoCapitalize="none" /></Field>
        <button className="btn" disabled={busy || !cfg.configured} onClick={test}>{busy ? 'Memproses…' : 'Kirim email uji'}</button>
      </section>
      <section className="card">
        <h3>Cara membuat App password Gmail</h3>
        <ol className="small">
          <li>Pakai akun Gmail khusus toko bila ada.</li>
          <li>Aktifkan <b>Verifikasi 2 Langkah</b> di Akun Google › Keamanan.</li>
          <li>Buka <b>myaccount.google.com/apppasswords</b>, buat app password bernama “Kasir Buket”.</li>
          <li>Salin 16 huruf yang muncul ke kolom App password di samping, lalu Simpan dan Kirim email uji.</li>
        </ol>
        <p className="muted small">App password hanya tersimpan di server dan tidak pernah dikirim ke HP atau browser. Setiap pengguna perlu punya email di Pengaturan › Pengguna agar bisa memakai “Lupa kata sandi?”.</p>
        <p className="muted small">Server harus terhubung ke internet agar email terkirim. Bila Gmail menolak, cabut app password lama lalu buat yang baru.</p>
      </section>
    </div>
  );
}
