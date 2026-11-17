// Pembaruan sekali klik untuk server Kasir Buket di PC toko (Windows). Dipanggil oleh deploy\perbarui.bat.
// Urutan: 1) build aplikasi (app/dist)  2) hentikan server lama, cadangkan basis data, jalankan server baru
//         3) commit ke Git               4) push ke GitHub
// Setiap langkah dicatat di deploy/perbarui.log. Aman dijalankan berulang; bila build gagal, server tidak disentuh.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOG = path.join(ROOT, 'deploy', 'perbarui.log');
const MSG = path.join(ROOT, 'deploy', 'pesan-commit.txt');
const PORT = Number(process.env.PORT || 8080);

/** PID yang mendengarkan di port (keluaran `netstat -ano -p tcp`). Tidak bergantung bahasa Windows: soket dengar beralamat lawan 0.0.0.0:0 / [::]:0. */
export function listeningPids(netstat, port) {
  const out = new Set();
  for (const line of String(netstat).split(/\r?\n/)) {
    const t = line.trim().split(/\s+/);
    if (t.length < 4 || t[0].toUpperCase() !== 'TCP') continue;
    if (!t[1].endsWith(`:${port}`) || !/^(0\.0\.0\.0|\[::\]|\*):(0|\*)$/.test(t[2])) continue;
    const pid = Number(t[t.length - 1]);
    if (pid > 0) out.add(pid);
  }
  return [...out];
}

/**
 * Berkas BARU (belum terlacak Git) yang boleh ikut commit otomatis. Repositori ini publik, jadi hanya jenis berkas
 * sumber yang lolos; basis data, ekspor, arsip, kunci, dan lembar kerja tidak pernah ditambahkan otomatis.
 */
export function safeNewFile(rel, size = 0) {
  const f = rel.replace(/\\/g, '/');
  if (size > 2 * 1024 * 1024) return false;
  if (/(^|\/)(data|backups|node_modules|dist)\//.test(f)) return false;
  if (/\.(ts|tsx|js|mjs|cjs|css|md|html|bat|sh|yml|yaml|svg|java|gradle|xml|webmanifest|service|conf)$/i.test(f)) return true;
  if (/\.json$/i.test(f)) return /^(app|server|\.github|\.claude)\//.test(f) && !/ekspor|export|backup/i.test(f);
  if (/\.png$/i.test(f)) return /^(app|docs)\//.test(f);
  return false;
}

const lines = [];
function log(s) {
  console.log(s);
  lines.push(s);
  try { fs.writeFileSync(LOG, lines.join('\n') + '\n'); } catch { /* catatan gagal ditulis: lanjut */ }
}
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', windowsHide: true, ...opts });
const tail = (s, n = 12) => String(s || '').trim().split(/\r?\n/).slice(-n).join('\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function health() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: AbortSignal.timeout(2000) });
    return (await r.json()).version || null;
  } catch { return null; }
}

function findGit() {
  const cands = ['git', 'C:\\Program Files\\Git\\cmd\\git.exe', 'C:\\Program Files\\Git\\bin\\git.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'cmd', 'git.exe'), 'C:\\msys64\\usr\\bin\\git.exe', 'C:\\msys64\\ucrt64\\bin\\git.exe'];
  for (const g of cands) {
    if (g !== 'git' && !fs.existsSync(g)) continue;
    const r = sh(g, ['--version']);
    if (r.status === 0) return g;
  }
  return null;
}

async function restartServer() {
  const before = await health();
  const pids = listeningPids(sh('netstat', ['-ano', '-p', 'tcp']).stdout, PORT);
  for (const pid of pids) {
    const name = sh('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']).stdout || '';
    if (!/^"node(\.exe)?"/i.test(name.trim())) { log(`  Port ${PORT} dipakai proses lain (PID ${pid}: ${name.trim().split(',')[0]}). Server tidak dimulai ulang.`); return null; }
    // jendela lama (cmd yang menjalankan jalankan-lokal-windows.bat) ikut ditutup agar tidak menumpuk
    let parent = null;
    try {
      const q = `$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; $pp=Get-CimInstance Win32_Process -Filter ('ProcessId='+$p.ParentProcessId); Write-Output ($pp.ProcessId.ToString()+'|'+$pp.Name+'|'+$pp.CommandLine)`;
      const [ppid, pname, pcmd] = (sh('powershell', ['-NoProfile', '-Command', q], { timeout: 15000 }).stdout || '').trim().split('|');
      if (/^cmd\.exe$/i.test(pname || '') && /jalankan-lokal-windows/i.test(pcmd || '')) parent = Number(ppid);
    } catch { /* tanpa PowerShell: jendela lama dibiarkan */ }
    const k = sh('taskkill', ['/PID', String(pid), '/F']);
    log(`  Server lama (PID ${pid}${before ? `, v${before}` : ''}) dihentikan: ${k.status === 0 ? 'ok' : tail(k.stderr || k.stdout, 2)}`);
    if (parent) sh('taskkill', ['/PID', String(parent), '/F']);
  }
  for (let i = 0; i < 20 && listeningPids(sh('netstat', ['-ano', '-p', 'tcp']).stdout, PORT).length; i++) await sleep(250);
  if (listeningPids(sh('netstat', ['-ano', '-p', 'tcp']).stdout, PORT).length) { log(`  Port ${PORT} masih terpakai. Tutup jendela server lama, lalu jalankan lagi.`); return null; }

  // cadangan basis data sebelum server baru menjalankan migrasi (5 set terakhir disimpan)
  const dataDir = path.join(ROOT, 'data');
  if (fs.existsSync(path.join(dataDir, 'kasir.db'))) {
    const dir = path.join(dataDir, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    for (const f of ['kasir.db', 'kasir.db-wal', 'kasir.db-shm']) {
      if (fs.existsSync(path.join(dataDir, f))) fs.copyFileSync(path.join(dataDir, f), path.join(dir, `sebelum-pembaruan-${stamp}-${f}`));
    }
    const sets = [...new Set(fs.readdirSync(dir).filter((f) => f.startsWith('sebelum-pembaruan-')).map((f) => f.slice(0, 'sebelum-pembaruan-'.length + 19)))].sort();
    for (const old of sets.slice(0, -5)) for (const f of fs.readdirSync(dir)) if (f.startsWith(old)) fs.rmSync(path.join(dir, f), { force: true });
    log(`  Cadangan basis data: data\\backups\\sebelum-pembaruan-${stamp}-kasir.db`);
  }

  const bat = path.join(ROOT, 'deploy', 'jalankan-lokal-windows.bat');
  spawn('cmd.exe', ['/c', 'start', '"Kasir Buket Server"', `"${bat}"`], { cwd: ROOT, detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
  for (let i = 0; i < 40; i++) { const v = await health(); if (v) return v; await sleep(500); }
  return null;
}

function gitSave(git) {
  const g = (args, opts) => sh(git, args, { env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' }, ...opts });
  g(['add', '-u']);
  const untracked = (g(['ls-files', '--others', '--exclude-standard', '-z']).stdout || '').split('\0').filter(Boolean);
  const size = (f) => { try { return fs.statSync(path.join(ROOT, f)).size; } catch { return 0; } };
  const ok = untracked.filter((f) => safeNewFile(f, size(f)));
  const skipped = untracked.filter((f) => !safeNewFile(f, size(f)));
  for (let i = 0; i < ok.length; i += 50) g(['add', '--', ...ok.slice(i, i + 50)]);
  if (ok.length) log(`  Berkas baru ikut commit: ${ok.join(', ')}`);
  if (skipped.length) log(`  Berkas baru TIDAK ikut commit (bukan berkas sumber, tambahkan manual bila memang perlu): ${skipped.join(', ')}`);

  let commit = 'tidak ada perubahan';
  if (g(['diff', '--cached', '--quiet']).status !== 0) {
    let ver = '';
    try { ver = JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'package.json'), 'utf8')).version; } catch { /* abaikan */ }
    const useFile = fs.existsSync(MSG) && fs.readFileSync(MSG, 'utf8').trim().length > 0;
    const c = g(['commit', ...(useFile ? ['-F', MSG] : ['-m', `Pembaruan Kasir Buket v${ver} (${new Date().toISOString().slice(0, 10)})`])]);
    if (c.status !== 0) { log(`  COMMIT GAGAL:\n${tail(c.stderr || c.stdout)}`); return { commit: 'GAGAL', push: 'dilewati' }; }
    if (useFile) fs.rmSync(MSG, { force: true });
    commit = (g(['log', '--oneline', '-1']).stdout || '').trim();
  }
  log(`  Commit: ${commit}`);
  const p = g(['push'], { timeout: 90000 });
  const push = p.status === 0 ? 'ok' : 'GAGAL';
  if (p.status !== 0) log(`  PUSH GAGAL (jalankan "git push" di Git Bash untuk masuk ke GitHub):\n${tail(p.stderr || p.stdout, 8)}`);
  log(`  Status: ${(g(['status', '-sb']).stdout || '').split(/\r?\n/)[0]}`);
  return { commit, push };
}

async function main() {
  log(`==== Pembaruan Kasir Buket ${new Date().toLocaleString('id-ID')} ====`);
  if (process.platform !== 'win32') { log('Skrip ini untuk PC Windows. Di VPS: git pull, npm run build di folder app, lalu systemctl restart kasir-buket (docs/PANDUAN.md bagian 3).'); process.exit(1); }

  log('[1/4] Build aplikasi (npm run build)...');
  const b = sh('npm', ['run', 'build'], { cwd: path.join(ROOT, 'app'), shell: true });
  if (b.status !== 0) {
    log(`BUILD GAGAL. Server tidak diubah.\n${tail(`${b.stdout}\n${b.stderr}`, 25)}`);
    log('HASIL: BUILD GAGAL');
    process.exit(1);
  }
  log('  Build ok.');

  log('[2/4] Mulai ulang server...');
  const ver = await restartServer();
  log(ver ? `  Server v${ver} berjalan di http://localhost:${PORT}` : '  SERVER BELUM MENJAWAB. Jalankan deploy\\jalankan-lokal-windows.bat secara manual.');

  log('[3/4] Commit dan [4/4] push...');
  const git = findGit();
  const r = git ? gitSave(git) : { commit: 'git tidak ditemukan', push: 'dilewati' };
  if (!git) log('  Git tidak ditemukan di PATH Windows. Commit dan push lewat Git Bash: git add -A && git commit -m "pembaruan" && git push');

  log(`HASIL: BUILD OK | SERVER ${ver ? `v${ver}` : 'BELUM MENJAWAB'} | COMMIT ${r.commit} | PUSH ${r.push}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { log(`GALAT: ${e.stack || e.message}`); process.exit(1); });
