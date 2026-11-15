// Pembuat undangan kalender iCalendar (RFC 5545) dengan metode iTIP (RFC 5546): REQUEST = buat/ubah, CANCEL = hapus.
// Dikirim sebagai email biasa; Gmail/Google Calendar, Outlook, dan Apple Calendar membacanya sebagai undangan.

const pad = (n) => String(n).padStart(2, '0');

/** Waktu UTC format iCalendar: 20261115T070000Z */
export function icsTime(d) {
  const t = new Date(d);
  return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}T${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}${pad(t.getUTCSeconds())}Z`;
}

/** Escape teks sesuai RFC 5545 §3.3.11 (\\ ; , dan baris baru). */
export function icsText(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Lipat baris > 75 oktet (RFC 5545 §3.1) tanpa memotong karakter UTF-8. */
export function fold(line) {
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch, 'utf8');
    const limit = out.length ? 74 : 75; // baris lanjutan diawali 1 spasi
    if (bytes + b > limit) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const cn = (s) => `"${String(s || '').replace(/["\r\n]/g, '')}"`;

/**
 * @param {{method:'REQUEST'|'CANCEL', uid:string, sequence:number, start:Date|string, end:Date|string, stamp?:Date,
 *   summary:string, description?:string, location?:string, organizer:{email:string,name?:string}, attendee:{email:string,name?:string},
 *   alarmMinutes?:number}} e
 */
export function buildIcs(e) {
  const cancel = e.method === 'CANCEL';
  const lines = [
    'BEGIN:VCALENDAR',
    'PRODID:-//Kasir Buket//Notifikasi Perangkai//ID',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    `METHOD:${e.method}`,
    'BEGIN:VEVENT',
    `UID:${e.uid}`,
    `SEQUENCE:${e.sequence}`,
    `DTSTAMP:${icsTime(e.stamp || new Date())}`,
    `DTSTART:${icsTime(e.start)}`,
    `DTEND:${icsTime(e.end)}`,
    `SUMMARY:${icsText(e.summary)}`,
    ...(e.description ? [`DESCRIPTION:${icsText(e.description)}`] : []),
    ...(e.location ? [`LOCATION:${icsText(e.location)}`] : []),
    `ORGANIZER;CN=${cn(e.organizer.name)}:mailto:${e.organizer.email}`,
    `ATTENDEE;CN=${cn(e.attendee.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=FALSE:mailto:${e.attendee.email}`,
    `STATUS:${cancel ? 'CANCELLED' : 'CONFIRMED'}`,
    'TRANSP:OPAQUE',
    ...(!cancel && e.alarmMinutes ? ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(e.summary)}`, `TRIGGER:-PT${Math.round(e.alarmMinutes)}M`, 'END:VALARM'] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}
