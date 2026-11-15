// Klien SMTP minimal tanpa dependensi (cukup untuk Gmail, Brevo, Mailtrap, dsb.).
// Port 465 = TLS langsung; port lain = STARTTLS (wajib, kecuali ke localhost untuk pengujian).
import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';
import os from 'node:os';

const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');
const encodeHeader = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const isLocal = (h) => ['localhost', '127.0.0.1', '::1'].includes(h);

function lineReader(socket) {
  let buf = '';
  let waiters = [];
  const replies = [];
  let current = [];
  let failed = null;
  const flush = () => {
    while (waiters.length && (replies.length || failed)) {
      const w = waiters.shift();
      if (replies.length) w.resolve(replies.shift());
      else w.reject(failed);
    }
  };
  const onData = (d) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      current.push(line);
      if (/^\d{3}( |$)/.test(line)) {
        replies.push({ code: Number(line.slice(0, 3)), lines: current });
        current = [];
      }
    }
    flush();
  };
  const onErr = (e) => { failed = e; flush(); };
  socket.on('data', onData);
  socket.on('error', onErr);
  socket.on('close', () => onErr(new Error('Koneksi SMTP tertutup')));
  return {
    next: () => new Promise((resolve, reject) => { waiters.push({ resolve, reject }); flush(); }),
    detach: () => { socket.off('data', onData); socket.off('error', onErr); },
  };
}

/**
 * @param {{host:string, port:number, user?:string, pass?:string, from:string, fromName?:string}} cfg
 * @param {{to:string, subject:string, text:string}} msg
 */
export async function sendMail(cfg, msg, { timeoutMs = 20000 } = {}) {
  const port = Number(cfg.port) || 465;
  const implicitTls = port === 465;
  let socket = implicitTls
    ? tls.connect({ host: cfg.host, port, servername: cfg.host })
    : net.connect({ host: cfg.host, port });
  socket.setTimeout(timeoutMs, () => socket.destroy(new Error('SMTP tidak merespons (timeout)')));
  await new Promise((res, rej) => {
    socket.once(implicitTls ? 'secureConnect' : 'connect', res);
    socket.once('error', rej);
  });
  let rd = lineReader(socket);
  const write = (s) => socket.write(s + '\r\n');
  const expect = async (codes, step) => {
    const r = await rd.next();
    if (!codes.includes(r.code)) throw new Error(`SMTP ${step} ditolak: ${r.lines.join(' ').slice(0, 200)}`);
    return r;
  };
  const cmd = async (line, codes, step) => { write(line); return expect(codes, step); };
  const helo = os.hostname().replace(/[^A-Za-z0-9.-]/g, '') || 'kasir-buket';

  try {
    await expect([220], 'salam');
    let ehlo = await cmd(`EHLO ${helo}`, [250], 'EHLO');
    if (!implicitTls) {
      const canStartTls = ehlo.lines.some((l) => /STARTTLS/i.test(l));
      if (canStartTls) {
        await cmd('STARTTLS', [220], 'STARTTLS');
        rd.detach();
        socket = tls.connect({ socket, servername: cfg.host });
        await new Promise((res, rej) => { socket.once('secureConnect', res); socket.once('error', rej); });
        rd = lineReader(socket);
        ehlo = await cmd(`EHLO ${helo}`, [250], 'EHLO');
      } else if (!isLocal(cfg.host)) {
        throw new Error('Server SMTP tidak mendukung enkripsi (STARTTLS). Gunakan port 465.');
      }
    }
    if (cfg.user) {
      await cmd('AUTH LOGIN', [334], 'AUTH');
      await cmd(b64(cfg.user), [334], 'AUTH user');
      await cmd(b64(cfg.pass || ''), [235], 'login (periksa email & app password)');
    }
    await cmd(`MAIL FROM:<${cfg.from}>`, [250], 'MAIL FROM');
    await cmd(`RCPT TO:<${msg.to}>`, [250, 251], 'RCPT TO');
    await cmd('DATA', [354], 'DATA');
    const domain = String(cfg.from).split('@')[1] || 'localhost';
    const headers = [
      `From: ${cfg.fromName ? `${encodeHeader(cfg.fromName)} ` : ''}<${cfg.from}>`,
      `To: <${msg.to}>`,
      `Subject: ${encodeHeader(msg.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${crypto.randomBytes(12).toString('hex')}@${domain}>`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
    ];
    const body = b64(msg.text).replace(/.{1,76}/g, '$&\r\n');
    socket.write(headers.join('\r\n') + '\r\n\r\n' + body + '.\r\n');
    await expect([250], 'kirim pesan');
    write('QUIT');
  } finally {
    setTimeout(() => socket.destroy(), 200);
  }
}
