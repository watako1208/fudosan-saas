"use client";
// 帳票のブロック編集（見出し・文章・表・画像・改ページ・余白）。表は行・列の追加削除が可能。
import type { DocBlock } from "@/lib/types";
import { BLOCK_TYPE_LABEL, LIST_SOURCES } from "@/lib/labels-documents";
import { blockEquals, stripMeta, type XBlock } from "@/lib/server/docgen/engine";

export interface ImageOption {
  id: string;
  fileName: string;
}

export function newKey() {
  return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function newBlock(type: DocBlock["type"]): XBlock {
  const key = newKey();
  switch (type) {
    case "heading":
      return { type, text: "", level: 2, key, tpl: null };
    case "paragraph":
      return { type, text: "", key, tpl: null };
    case "table":
      return { type, columns: ["項目", "内容"], rows: [["", ""]], key, tpl: null };
    case "image":
      return { type, attachmentId: "", caption: "", widthPct: 60, key, tpl: null };
    case "pagebreak":
      return { type, key, tpl: null };
    case "spacer":
      return { type, height: 16, key, tpl: null };
  }
}

const TYPES: DocBlock["type"][] = ["heading", "paragraph", "table", "image", "pagebreak", "spacer"];

export function BlockEditor({
  blocks,
  onChange,
  images,
  templateMode = false,
  autoRendered,
  disabled = false,
}: {
  blocks: XBlock[];
  onChange: (b: XBlock[]) => void;
  images: ImageOption[];
  templateMode?: boolean;
  autoRendered?: Record<string, DocBlock>;
  disabled?: boolean;
}) {
  const set = (i: number, b: XBlock) => onChange(blocks.map((x, j) => (j === i ? b : x)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const remove = (i: number) => {
    if (!window.confirm("このブロックを削除しますか？")) return;
    onChange(blocks.filter((_, j) => j !== i));
  };
  const insert = (i: number, type: DocBlock["type"]) => {
    const next = [...blocks];
    next.splice(i, 0, newBlock(type));
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {blocks.length === 0 && <p className="rounded-md border border-dashed border-line p-4 text-sm text-muted">ブロックがありません。下のボタンから追加してください。</p>}
      {blocks.map((b, i) => {
        const auto = !templateMode && b.key && autoRendered ? autoRendered[b.key] : undefined;
        const origin = templateMode ? null : b.tpl === null || b.tpl === undefined ? "手動追加" : auto && !blockEquals(stripMeta(b), auto) ? "手動修正" : "差込み（未修正）";
        return (
          <div key={b.key ?? i} className="rounded-md border border-line bg-surface">
            <div className="flex flex-wrap items-center gap-2 border-b border-line bg-[#f8f9fb] px-3 py-1.5 text-sm">
              <span className="font-semibold">{i + 1}. {BLOCK_TYPE_LABEL[b.type]}</span>
              {origin && <span className={`rounded border px-1.5 text-xs ${origin === "差込み（未修正）" ? "border-line text-muted" : "border-warn/40 bg-warn-soft text-warn"}`}>{origin}</span>}
              {!disabled && (
                <span className="ml-auto flex flex-wrap gap-1">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label="上へ">↑</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => move(i, 1)} disabled={i === blocks.length - 1} aria-label="下へ">↓</button>
                  <select className="input !min-h-8 !w-auto !py-0 text-xs" value="" onChange={(e) => e.target.value && insert(i + 1, e.target.value as DocBlock["type"])} aria-label="下に挿入">
                    <option value="">下に挿入…</option>
                    {TYPES.map((t) => <option key={t} value={t}>{BLOCK_TYPE_LABEL[t]}</option>)}
                  </select>
                  <button type="button" className="btn btn-ghost btn-sm !text-danger" onClick={() => remove(i)}>削除</button>
                </span>
              )}
            </div>
            <div className="p-3">
              <BlockBody b={b} onChange={(nb) => set(i, nb)} images={images} templateMode={templateMode} disabled={disabled} />
            </div>
          </div>
        );
      })}
      {!disabled && (
        <div className="flex flex-wrap gap-2">
          {TYPES.map((t) => (
            <button key={t} type="button" className="btn btn-secondary btn-sm" onClick={() => insert(blocks.length, t)}>＋ {BLOCK_TYPE_LABEL[t]}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function BlockBody({ b, onChange, images, templateMode, disabled }: { b: XBlock; onChange: (b: XBlock) => void; images: ImageOption[]; templateMode: boolean; disabled: boolean }) {
  switch (b.type) {
    case "heading":
      return (
        <div className="flex flex-wrap gap-2">
          <select className="input !w-auto" value={b.level} disabled={disabled} onChange={(e) => onChange({ ...b, level: Number(e.target.value) as 1 | 2 | 3 })} aria-label="見出しの大きさ">
            <option value={1}>大見出し</option>
            <option value={2}>中見出し</option>
            <option value={3}>小見出し</option>
          </select>
          <input className="input min-w-0 flex-1" value={b.text} disabled={disabled} onChange={(e) => onChange({ ...b, text: e.target.value })} aria-label="見出し" />
        </div>
      );
    case "paragraph":
      return <textarea className="input" rows={Math.min(14, Math.max(3, b.text.split("\n").length + 1))} value={b.text} disabled={disabled} onChange={(e) => onChange({ ...b, text: e.target.value })} aria-label="文章" />;
    case "table":
      return <TableBody b={b} onChange={onChange} templateMode={templateMode} disabled={disabled} />;
    case "image":
      return (
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="text-sm sm:col-span-1">
            <span className="label">画像</span>
            <select className="input" value={b.attachmentId} disabled={disabled} onChange={(e) => onChange({ ...b, attachmentId: e.target.value })}>
              <option value="">選択してください</option>
              {images.map((im) => <option key={im.id} value={im.id}>{im.fileName}</option>)}
              {b.attachmentId && !images.some((im) => im.id === b.attachmentId) && <option value={b.attachmentId}>（登録済みの画像）</option>}
            </select>
            {images.length === 0 && <span className="help">関連する物件・案件などの「写真・資料」に画像（JPEG・PNG・WebP）を登録すると選択できます</span>}
          </label>
          <label className="text-sm">
            <span className="label">説明</span>
            <input className="input" value={b.caption ?? ""} disabled={disabled} onChange={(e) => onChange({ ...b, caption: e.target.value })} />
          </label>
          <label className="text-sm">
            <span className="label">幅（%）</span>
            <input className="input" type="number" min={10} max={100} value={b.widthPct ?? 60} disabled={disabled} onChange={(e) => onChange({ ...b, widthPct: Number(e.target.value) })} />
          </label>
        </div>
      );
    case "pagebreak":
      return <p className="text-sm text-muted">ここで次のページに改ページします</p>;
    case "spacer":
      return (
        <label className="flex items-center gap-2 text-sm">
          余白の高さ
          <input className="input !w-28" type="number" min={4} max={200} value={b.height} disabled={disabled} onChange={(e) => onChange({ ...b, height: Number(e.target.value) })} />
          px
        </label>
      );
  }
}

function TableBody({ b, onChange, templateMode, disabled }: { b: Extract<XBlock, { type: "table" }>; onChange: (b: XBlock) => void; templateMode: boolean; disabled: boolean }) {
  const setCell = (ri: number, ci: number, v: string) => onChange({ ...b, rows: b.rows.map((r, i) => (i === ri ? b.columns.map((_, j) => (j === ci ? v : r[j] ?? "")) : r)) });
  const setCol = (ci: number, v: string) => onChange({ ...b, columns: b.columns.map((c, j) => (j === ci ? v : c)) });
  const addRow = (at: number) => {
    const rows = [...b.rows];
    rows.splice(at, 0, b.columns.map(() => ""));
    onChange({ ...b, rows });
  };
  const delRow = (ri: number) => onChange({ ...b, rows: b.rows.filter((_, i) => i !== ri) });
  const addCol = () => onChange({ ...b, columns: [...b.columns, `列${b.columns.length + 1}`], rows: b.rows.map((r) => [...r, ""]) });
  const delCol = (ci: number) => {
    if (b.columns.length <= 1) return;
    if (!window.confirm(`「${b.columns[ci]}」列を削除しますか？`)) return;
    onChange({ ...b, columns: b.columns.filter((_, j) => j !== ci), rows: b.rows.map((r) => r.filter((_, j) => j !== ci)) });
  };
  return (
    <div className="space-y-2">
      {templateMode && (
        <label className="flex flex-wrap items-center gap-2 text-sm">
          行の展開元
          <select className="input !w-auto" value={b.source ?? ""} disabled={disabled} onChange={(e) => onChange({ ...b, source: e.target.value || undefined })}>
            <option value="">なし（固定の表）</option>
            {Object.entries(LIST_SOURCES).map(([k, s]) => <option key={k} value={k}>{s.label}（{k}）</option>)}
          </select>
          {b.source && <span className="help !mt-0">1行目が明細ごとに繰り返されます。{"{{item.列名}}"} を使います（例: {Object.keys(LIST_SOURCES[b.source]?.columns ?? {}).slice(0, 3).map((c) => `{{item.${c}}}`).join(" ")}）。2行目以降は合計行などの固定行です。</span>}
        </label>
      )}
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              {b.columns.map((c, ci) => (
                <th key={ci} className="!p-1 align-top">
                  <input className="input !min-h-8 font-semibold" value={c} disabled={disabled} onChange={(e) => setCol(ci, e.target.value)} aria-label={`列${ci + 1}の見出し`} />
                  {!disabled && b.columns.length > 1 && <button type="button" className="mt-0.5 text-xs text-danger" onClick={() => delCol(ci)}>列を削除</button>}
                </th>
              ))}
              {!disabled && <th className="!p-1"><button type="button" className="btn btn-ghost btn-sm" onClick={addCol}>＋列</button></th>}
            </tr>
          </thead>
          <tbody>
            {b.rows.map((r, ri) => (
              <tr key={ri}>
                {b.columns.map((_, ci) => (
                  <td key={ci} className="!p-1">
                    <textarea className="input !min-h-8 !py-1 text-sm" rows={1} value={r[ci] ?? ""} disabled={disabled} onChange={(e) => setCell(ri, ci, e.target.value)} aria-label={`${ri + 1}行${ci + 1}列`} />
                  </td>
                ))}
                {!disabled && (
                  <td className="!p-1 whitespace-nowrap">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => addRow(ri + 1)} title="下に行を追加">＋行</button>
                    <button type="button" className="btn btn-ghost btn-sm !text-danger" onClick={() => delRow(ri)}>削除</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!disabled && <button type="button" className="btn btn-secondary btn-sm" onClick={() => addRow(b.rows.length)}>＋ 行を追加</button>}
    </div>
  );
}
