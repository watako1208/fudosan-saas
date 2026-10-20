// 書類本文の表示（印刷・プレビュー共通）。実際の文字として出力し、画像化しない。
// サーバー・クライアントのどちらからも使える（フックを使わない）。
import type { DocBlock } from "@/lib/types";
import { MISSING_TEXT } from "@/lib/labels-documents";

const NUMERIC = /^[-−]?[¥￥]?[\d,]+(\.\d+)?(円|%|％|㎡|か月|本|日)?$/;

function Text({ text, mark }: { text: string; mark: boolean }) {
  if (!mark || !text.includes(MISSING_TEXT)) return <>{text}</>;
  const parts = text.split(MISSING_TEXT);
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>
          {p}
          {i < parts.length - 1 && <span className="doc-missing">{MISSING_TEXT}</span>}
        </span>
      ))}
    </>
  );
}

export function DocBlocksView({ blocks, markMissing = true }: { blocks: DocBlock[]; markMissing?: boolean }) {
  return (
    <div className="doc-root">
      {blocks.map((b, i) => {
        switch (b.type) {
          case "heading": {
            const H = (`h${b.level}` as "h1" | "h2" | "h3");
            return <H key={i}><Text text={b.text} mark={markMissing} /></H>;
          }
          case "paragraph":
            return <p key={i}><Text text={b.text} mark={markMissing} /></p>;
          case "table":
            return (
              <table key={i}>
                <thead>
                  <tr>{b.columns.map((c, ci) => <th key={ci} scope="col"><Text text={c} mark={markMissing} /></th>)}</tr>
                </thead>
                <tbody>
                  {b.rows.map((r, ri) => (
                    <tr key={ri}>
                      {b.columns.map((_, ci) => {
                        const v = r[ci] ?? "";
                        return (
                          <td key={ci} className={NUMERIC.test(v.trim()) ? "doc-num" : undefined}>
                            <Text text={v} mark={markMissing} />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          case "image":
            return (
              <figure key={i} className="doc-figure" style={{ width: `${b.widthPct ?? 60}%` }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/files/${encodeURIComponent(b.attachmentId)}`} alt={b.caption ?? "画像"} />
                {b.caption && <figcaption><Text text={b.caption} mark={markMissing} /></figcaption>}
              </figure>
            );
          case "pagebreak":
            return <div key={i} className="doc-pagebreak" role="separator" aria-label="改ページ" />;
          case "spacer":
            return <div key={i} style={{ height: `${b.height}px` }} aria-hidden />;
        }
      })}
    </div>
  );
}

/** A4 帳票用のスタイル（画面プレビューと印刷で共通） */
export const DOC_CSS = `
.doc-root { font-family: "Yu Gothic", "游ゴシック", "YuGothic", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Meiryo", sans-serif; color: #111; font-size: 10.5pt; line-height: 1.7; }
.doc-root h1 { font-size: 18pt; font-weight: 700; text-align: center; margin: 0 0 6mm; letter-spacing: 0.1em; }
.doc-root h2 { font-size: 13pt; font-weight: 700; margin: 6mm 0 2.5mm; padding-bottom: 1mm; border-bottom: 1px solid #333; break-after: avoid; page-break-after: avoid; }
.doc-root h3 { font-size: 11pt; font-weight: 700; margin: 4mm 0 2mm; break-after: avoid; page-break-after: avoid; }
.doc-root h1, .doc-root h2, .doc-root h3, .doc-root p, .doc-root td, .doc-root th, .doc-root figcaption { white-space: pre-wrap; overflow-wrap: anywhere; word-break: normal; line-break: strict; }
.doc-root p { margin: 0 0 3mm; orphans: 2; widows: 2; }
.doc-root table { width: 100%; border-collapse: collapse; margin: 0 0 4mm; table-layout: auto; }
.doc-root thead { display: table-header-group; }
.doc-root tr { break-inside: avoid; page-break-inside: avoid; }
.doc-root th, .doc-root td { border: 0.75pt solid #444; padding: 1.4mm 2mm; vertical-align: top; text-align: left; font-size: 9.5pt; }
.doc-root th { background: #eeeeee; font-weight: 700; }
.doc-root td.doc-num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.doc-root .doc-figure { margin: 2mm 0 4mm; break-inside: avoid; page-break-inside: avoid; }
.doc-root .doc-figure img { display: block; max-width: 100%; height: auto; }
.doc-root .doc-figure figcaption { font-size: 9pt; color: #333; margin-top: 1mm; }
.doc-root .doc-missing { background: #fff3c4; color: #7a5200; border-bottom: 1px dashed #b07d00; }
.doc-root .doc-pagebreak { break-after: page; page-break-after: always; height: 0; border-top: 1px dashed #9aa3af; margin: 6mm 0; }
.doc-sheet { background: #fff; width: 210mm; max-width: 100%; min-height: 297mm; margin: 0 auto; padding: 18mm 16mm; box-shadow: 0 1px 4px rgba(0,0,0,.15); }
@media print {
  .doc-root .doc-missing { background: none; color: inherit; border: 0; }
  .doc-root .doc-pagebreak { border: 0; margin: 0; }
}
`;
