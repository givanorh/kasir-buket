import { layout, type Line } from '../lib/print/escpos';

/** Pratinjau kertas thermal: baris & lebar persis seperti hasil cetak. */
export function ReceiptPreview({ doc, width = 58, testId }: { doc: Line[]; width?: 58 | 80; testId?: string }) {
  const lines = layout(doc, width);
  const cols = width === 80 ? 48 : 32;
  return (
    <div className="paper" style={{ width: `calc(${cols}ch + 26px)` }} data-testid={testId}>
      {lines.map((r, i) => (
        <div key={i} className={`${r.bold ? 'b ' : ''}${r.size === 2 ? 's2 ' : ''}${r.align}`}>{r.text}</div>
      ))}
    </div>
  );
}
