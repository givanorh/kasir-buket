// Keluar akun dengan pengingat shift: bila perangkat ini masih punya shift terbuka, tawarkan tutup shift dulu,
// tetapi tetap izinkan keluar tanpa menutup shift (shift tetap terbuka dan bisa ditutup nanti).
import { useState, type ReactNode } from 'react';
import { db } from '../lib/db';
import { shiftSummary } from '../lib/calc';
import { fmtShort, rp } from '../lib/format';
import { getSession, logout } from '../lib/session';
import { activeShift } from '../lib/store';
import { sync } from '../lib/sync';
import { Modal } from './ui';
import type { Shift } from '../lib/types';

async function doLogout() {
  sync.stop();
  await logout();
}

/**
 * `request(confirmText?)`: mulai proses keluar. Dengan shift terbuka → jendela pengingat; tanpa shift → `confirmText`
 * (bila diisi) ditanyakan dulu, lalu keluar. `modal` dirender oleh pemanggil.
 */
export function useLogout(): [(confirmText?: string) => Promise<void>, ReactNode] {
  const [open, setOpen] = useState<{ shift: Shift; expected: number } | null>(null);
  async function request(confirmText?: string) {
    const sh = await activeShift();
    if (sh) {
      const [ps, ms] = await Promise.all([db.payments.where('shift_id').equals(sh.id).toArray(), db.cash_moves.where('shift_id').equals(sh.id).toArray()]);
      setOpen({ shift: sh, expected: shiftSummary(sh, ps, ms).expected });
      return;
    }
    if (confirmText && !window.confirm(confirmText)) return;
    await doLogout();
  }
  const mine = open && open.shift.user_id === getSession().user?.id;
  const modal = open && (
    <Modal title="Shift masih terbuka" onClose={() => setOpen(null)}
      footer={<>
        <button className="btn" onClick={() => setOpen(null)}>Batal</button>
        <button className="btn ghost danger" onClick={async () => { setOpen(null); await doLogout(); }} data-testid="keluar-tanpa-tutup">Tetap keluar</button>
        <button className="btn primary grow" onClick={() => { setOpen(null); location.hash = '#/shift'; }} data-testid="ke-tutup-shift">Tutup shift dulu</button>
      </>}>
      <div className="stack" data-testid="pengingat-shift">
        <p>Shift {mine ? 'Anda' : open.shift.user_name || ''} di perangkat ini dibuka sejak <b>{fmtShort(open.shift.opened_at)}</b> dan belum ditutup.</p>
        <div className="sum"><div className="row total"><span>Kas seharusnya di laci kasir</span><span>{rp(open.expected)}</span></div></div>
        <p className="muted small">Tutup shift dulu agar uang di laci kasir direkap dan selisihnya tercatat. Bila keluar sekarang, shift tetap terbuka dan bisa ditutup saat masuk lagi di perangkat ini.</p>
      </div>
    </Modal>
  );
  return [request, modal];
}
