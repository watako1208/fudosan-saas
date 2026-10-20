"use client";
import { ReactNode } from "react";

/**
 * A4 印刷用の表示。ブラウザの印刷から「PDFに保存」で PDF にできる。
 * 印刷時はアプリの画面枠（メニュー等）を隠し、この領域だけを出力する。
 */
export function PrintView({ children, backHref }: { children: ReactNode; backHref: string }) {
  return (
    <>
      <style>{`
        @page { size: A4; margin: 15mm 12mm; }
        .print-sheet { background: #fff; color: #111; max-width: 210mm; margin: 0 auto; padding: 12mm; box-shadow: 0 1px 4px rgba(0,0,0,.12); font-size: 10.5pt; line-height: 1.6; }
        .print-sheet table { width: 100%; border-collapse: collapse; }
        .print-sheet th, .print-sheet td { border: 1px solid #999; padding: 4px 6px; vertical-align: top; word-break: break-word; }
        .print-sheet th { background: #f2f2f2; font-weight: 600; text-align: left; }
        .print-sheet tr { break-inside: avoid; }
        .print-sheet thead { display: table-header-group; }
        .print-sheet .r { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
        @media print {
          body * { visibility: hidden !important; }
          .print-sheet, .print-sheet * { visibility: visible !important; }
          .print-sheet { position: absolute; left: 0; top: 0; width: 100%; max-width: none; padding: 0; box-shadow: none; }
          .no-print { display: none !important; }
        }
      `}</style>
      <div className="no-print mb-4 flex flex-wrap gap-2">
        <a href={backHref} className="btn btn-secondary">← 戻る</a>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>印刷・PDFに保存</button>
        <span className="self-center text-sm text-muted">印刷画面で「PDFに保存」を選ぶとPDFになります（A4）。</span>
      </div>
      <div className="print-sheet">{children}</div>
    </>
  );
}
