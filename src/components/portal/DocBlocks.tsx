import type { DocBlock } from "@/lib/types";

/** 発行済み書類の版を表示する（版に固定された編集内容をそのまま描画。差込み元の最新値では描画しない） */
export function DocBlocks({ blocks }: { blocks: DocBlock[] }) {
  return (
    <div className="space-y-3 leading-relaxed">
      {blocks.map((b, i) => {
        switch (b.type) {
          case "heading": {
            const cls = b.level === 1 ? "text-xl font-bold" : b.level === 2 ? "text-lg font-bold" : "font-bold";
            return <p key={i} className={cls}>{b.text}</p>;
          }
          case "paragraph":
            return <p key={i} className="break-words whitespace-pre-wrap">{b.text}</p>;
          case "table":
            return (
              <div key={i} className="overflow-x-auto">
                <table className="table">
                  <thead><tr>{b.columns.map((c, j) => <th key={j}>{c}</th>)}</tr></thead>
                  <tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k} className="break-words">{c}</td>)}</tr>)}</tbody>
                </table>
              </div>
            );
          case "image":
            return (
              <figure key={i} style={{ width: `${b.widthPct ?? 100}%` }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/files/${b.attachmentId}`} alt={b.caption ?? "書類内の画像"} className="max-w-full rounded border border-line" />
                {b.caption && <figcaption className="help">{b.caption}</figcaption>}
              </figure>
            );
          case "pagebreak":
            return <hr key={i} className="my-4 border-dashed border-line print:break-after-page print:border-0" />;
          case "spacer":
            return <div key={i} style={{ height: Math.min(200, b.height) }} />;
          default:
            return null;
        }
      })}
    </div>
  );
}
