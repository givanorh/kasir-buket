import { Icon } from './icons';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { num, parseRp } from '../lib/format';

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Tutup"><Icon name="close" /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** `group`: untuk isi non-input (mis. Seg) agar klik label tidak memicu tombol pertama. */
export function Field({ label, children, hint, group }: { label: string; children: ReactNode; hint?: ReactNode; group?: boolean }) {
  const inner = (
    <>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </>
  );
  return group ? <div className="field" role="group" aria-label={label}>{inner}</div> : <label className="field">{inner}</label>;
}

/** Input Rupiah: menampilkan pemisah ribuan, menerima "150rb" / "1,5jt". */
export function MoneyInput({ value, onChange, autoFocus, placeholder, ariaLabel }: { value: number; onChange: (n: number) => void; autoFocus?: boolean; placeholder?: string; ariaLabel?: string }) {
  const [text, setText] = useState(value ? num(value) : '');
  useEffect(() => { if (parseRp(text) !== value) setText(value ? num(value) : ''); }, [value]); // eslint-disable-line
  return (
    <div className="money">
      <span>Rp</span>
      <input
        inputMode="numeric" autoFocus={autoFocus} placeholder={placeholder || '0'} value={text} aria-label={ariaLabel}
        onChange={(e) => { setText(e.target.value); onChange(parseRp(e.target.value)); }}
        onBlur={() => setText(value ? num(value) : '')}
      />
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="radiogroup">
      {options.map((o) => (
        <button type="button" key={o.value} role="radio" aria-checked={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Badge({ tone = 'gray', children }: { tone?: 'gray' | 'green' | 'amber' | 'red' | 'blue' | 'rose'; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

// ---------- toast ----------
type Toast = { id: number; text: string; tone: 'ok' | 'err' | 'info' };
let toasts: Toast[] = [];
const tl = new Set<() => void>();
export function toast(text: string, tone: Toast['tone'] = 'ok') {
  const id = Date.now() + Math.random();
  toasts = [...toasts, { id, text, tone }];
  tl.forEach((l) => l());
  setTimeout(() => { toasts = toasts.filter((t) => t.id !== id); tl.forEach((l) => l()); }, tone === 'err' ? 6000 : 3000);
}
export function Toasts() {
  const list = useSyncExternalStore((l) => { tl.add(l); return () => tl.delete(l); }, () => toasts);
  return <div className="toasts">{list.map((t) => <div key={t.id} className={`toast ${t.tone}`}>{t.text}</div>)}</div>;
}

export function confirmDialog(msg: string) {
  return window.confirm(msg);
}
