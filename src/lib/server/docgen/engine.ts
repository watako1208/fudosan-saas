// 書類の差込み・再反映エンジン（純粋関数。サーバー専用 import を持たないため単体テスト可能）
//
// - 変数は {{path}}。表の行展開（table.source）では行テンプレート内で {{item.列名}} を使う。
// - 値がない項目は「未入力」と表示し、未確認項目として報告する（0 や「該当なし」に置き換えない）。
// - 作成時に描画したブロック（autoRendered）を保存し、再反映時は「描画時のまま」のブロックだけを置き換える。
//   手動修正したブロックは上書きしない。

import type { DocBlock } from "@/lib/types";
import { MISSING_TEXT, fieldLabel } from "../../labels-documents";

export type FieldValue = string | null;
export type ListRow = Record<string, FieldValue>;

export interface MergeMeta {
  entity: string;
  entityId: string;
  entityNumber: string | null;
  entityTitle: string;
  sourceUpdatedAt: string | null;
  candidatePartyIds: string[];
  attachEntities: { entity: string; id: string }[];
  builtAt: string;
}

export interface MergeData {
  fields: Record<string, FieldValue>;
  lists: Record<string, ListRow[] | null>;
  meta: MergeMeta;
}

/** 保存用ブロック: key=ブロック識別子, tpl=元テンプレートのブロック番号（手動追加は null） */
export type XBlock = DocBlock & { key?: string; tpl?: number | null };

const VAR_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

function isMissing(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

/** 文中の変数を解決する。値がないものは「未入力」とし、項目パスを missing に返す */
export function resolveText(
  text: string,
  data: Pick<MergeData, "fields">,
  row?: { source: string; index: number; values: ListRow | null },
): { text: string; missing: string[] } {
  const missing: string[] = [];
  const out = (text ?? "").replace(VAR_RE, (_m, path: string) => {
    if (path.startsWith("item.")) {
      const col = path.slice(5);
      if (!row) {
        missing.push(path);
        return MISSING_TEXT;
      }
      if (!row.values) {
        missing.push(row.source);
        return MISSING_TEXT;
      }
      const v = row.values[col];
      if (isMissing(v)) {
        missing.push(`${row.source}[${row.index}].${col}`);
        return MISSING_TEXT;
      }
      return String(v);
    }
    const v = data.fields[path];
    if (isMissing(v)) {
      missing.push(path);
      return MISSING_TEXT;
    }
    return String(v);
  });
  return { text: out, missing };
}

export const EMPTY_LIST_TEXT = "（明細はありません）";

/** テンプレートの1ブロックを差込みデータで描画する */
export function renderBlock(b: DocBlock, data: Pick<MergeData, "fields" | "lists">): { block: DocBlock; missing: string[] } {
  const missing: string[] = [];
  const r = (t: string, row?: Parameters<typeof resolveText>[2]) => {
    const x = resolveText(t, data, row);
    missing.push(...x.missing);
    return x.text;
  };
  switch (b.type) {
    case "heading":
      return { block: { type: "heading", level: b.level, text: r(b.text) }, missing };
    case "paragraph":
      return { block: { type: "paragraph", text: r(b.text) }, missing };
    case "image":
      return { block: { type: "image", attachmentId: b.attachmentId, ...(b.caption ? { caption: r(b.caption) } : {}), ...(b.widthPct ? { widthPct: b.widthPct } : {}) }, missing };
    case "pagebreak":
      return { block: { type: "pagebreak" }, missing };
    case "spacer":
      return { block: { type: "spacer", height: b.height }, missing };
    case "table": {
      const columns = b.columns.map((c) => r(c));
      let rows: string[][] = [];
      let staticRows = b.rows;
      if (b.source) {
        const tplRow = b.rows[0] ?? b.columns.map(() => "");
        staticRows = b.rows.slice(1);
        const list = data.lists[b.source];
        if (list === null || list === undefined) {
          // 明細そのものが不明: 「未入力」1行を出し、未確認項目として報告
          const x = tplRow.map((c) => resolveText(c, data, { source: b.source!, index: 0, values: null }));
          x.forEach((y) => missing.push(...y.missing));
          if (!x.some((y) => y.missing.includes(b.source!))) missing.push(b.source);
          rows.push(x.map((y) => y.text));
        } else if (list.length === 0) {
          rows.push(tplRow.map((_, i) => (i === 0 ? EMPTY_LIST_TEXT : "")));
        } else {
          rows = list.map((values, index) => tplRow.map((c) => r(c, { source: b.source!, index, values })));
        }
      }
      rows.push(...staticRows.map((row) => row.map((c) => r(c))));
      return { block: { type: "table", columns, rows }, missing };
    }
  }
}

function uniq(a: string[]) {
  return [...new Set(a)];
}

/** テンプレート全体を描画する（作成時） */
export function renderBlocks(tpl: DocBlock[], data: Pick<MergeData, "fields" | "lists">) {
  const blocks: XBlock[] = [];
  const autoRendered: Record<string, DocBlock> = {};
  const missing: string[] = [];
  tpl.forEach((b, i) => {
    const x = renderBlock(b, data);
    const key = `t${i}`;
    blocks.push({ ...x.block, key, tpl: i } as XBlock);
    autoRendered[key] = x.block;
    missing.push(...x.missing);
  });
  return { blocks, autoRendered, missing: uniq(missing) };
}

/** 保存メタ（key/tpl）を除いた本体 */
export function stripMeta(b: XBlock): DocBlock {
  const { key: _k, tpl: _t, ...rest } = b;
  void _k;
  void _t;
  return rest as DocBlock;
}

/** キー順・undefined に依存しない比較用文字列（Firestore はマップのキー順を保持しない） */
export function canonical(v: unknown): string {
  if (v === undefined) return "null";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(",")}}`;
}

export function blockEquals(a: DocBlock, b: DocBlock): boolean {
  return canonical(a) === canonical(b);
}

/** 描画時から手動で変更されたか（文言修正・ブロック追加・削除・並べ替えを含む） */
export function hasManualEdits(blocks: XBlock[], autoRendered: Record<string, DocBlock>): boolean {
  const present = new Set<string>();
  let lastTpl = -1;
  for (const b of blocks) {
    if (b.tpl === null || b.tpl === undefined || !b.key) return true;
    present.add(b.key);
    const auto = autoRendered[b.key];
    if (!auto || !blockEquals(stripMeta(b), auto)) return true;
    if (b.tpl < lastTpl) return true;
    lastTpl = b.tpl;
  }
  return Object.keys(autoRendered).some((k) => !present.has(k));
}

/** 手動で変更されたテンプレート由来ブロックのキー */
export function editedBlockKeys(blocks: XBlock[], autoRendered: Record<string, DocBlock>): string[] {
  return blocks
    .filter((b) => b.key && b.tpl !== null && b.tpl !== undefined && autoRendered[b.key] && !blockEquals(stripMeta(b), autoRendered[b.key]))
    .map((b) => b.key!);
}

/**
 * 「最新の値を再反映」: 描画時のまま（手動修正なし）の変数ブロックだけを新しい値で描画し直す。
 * 手動修正したブロック・手動追加したブロックは変更しない。
 */
export function rerenderBlocks(
  blocks: XBlock[],
  tpl: DocBlock[],
  autoRendered: Record<string, DocBlock>,
  data: Pick<MergeData, "fields" | "lists">,
): { blocks: XBlock[]; autoRendered: Record<string, DocBlock>; updated: string[]; changed: string[]; skipped: string[] } {
  const nextAuto: Record<string, DocBlock> = { ...autoRendered };
  const updated: string[] = [];
  const changed: string[] = [];
  const skipped: string[] = [];
  const out = blocks.map((b) => {
    if (b.tpl === null || b.tpl === undefined || !b.key || !tpl[b.tpl]) return b;
    const auto = autoRendered[b.key];
    if (!auto || !blockEquals(stripMeta(b), auto)) {
      skipped.push(b.key);
      return b;
    }
    const x = renderBlock(tpl[b.tpl], data);
    nextAuto[b.key] = x.block;
    updated.push(b.key);
    if (!blockEquals(x.block, auto)) changed.push(b.key);
    return { ...x.block, key: b.key, tpl: b.tpl } as XBlock;
  });
  return { blocks: out, autoRendered: nextAuto, updated, changed, skipped };
}

/** データ上の未確認項目（テンプレート全体を描画して集計） */
export function missingFields(tpl: DocBlock[], data: Pick<MergeData, "fields" | "lists">): string[] {
  return renderBlocks(tpl, data).missing;
}

/** 必須項目のうち値がないもの */
export function requiredMissing(required: string[], data: Pick<MergeData, "fields" | "lists">): string[] {
  return required.filter((p) => {
    if (p in data.lists) return data.lists[p] === null || data.lists[p] === undefined;
    return isMissing(data.fields[p]);
  });
}

/** 本文に残っている「未入力」の数 */
export function countMissingText(blocks: DocBlock[]): number {
  const re = new RegExp(MISSING_TEXT, "g");
  let n = 0;
  const c = (s: string | undefined) => {
    if (s) n += (s.match(re) ?? []).length;
  };
  for (const b of blocks) {
    if (b.type === "heading" || b.type === "paragraph") c(b.text);
    else if (b.type === "table") {
      b.columns.forEach(c);
      b.rows.forEach((r) => r.forEach(c));
    } else if (b.type === "image") c(b.caption);
  }
  return n;
}

export function describeMissing(paths: string[]): { path: string; label: string }[] {
  return uniq(paths).map((path) => ({ path, label: fieldLabel(path) }));
}

/** テンプレートで使われている変数 */
export function extractVars(blocks: DocBlock[]): string[] {
  const out: string[] = [];
  const grab = (s: string | undefined) => {
    if (!s) return;
    for (const m of s.matchAll(VAR_RE)) out.push(m[1]);
  };
  for (const b of blocks) {
    if (b.type === "heading" || b.type === "paragraph") grab(b.text);
    else if (b.type === "table") {
      b.columns.forEach(grab);
      b.rows.forEach((r) => r.forEach(grab));
      if (b.source) out.push(b.source);
    } else if (b.type === "image") grab(b.caption);
  }
  return uniq(out);
}

// ───────────── 領収書の金額（実際の入金配分のみ） ─────────────

export interface ReceiptAllocation {
  amount: number;
  reversed: boolean;
}

/**
 * 領収書の金額 = 取消されていない入金配分の合計。請求額（未入金を含む）では発行しない。
 * 入金がなければエラー。
 */
export function receiptAmount(
  invoice: { status: string; total: number },
  allocations: ReceiptAllocation[],
): { ok: true; amount: number } | { ok: false; error: string } {
  if (invoice.status === "cancelled") return { ok: false, error: "取消済みの請求には領収書を作成できません" };
  const amount = allocations.filter((a) => !a.reversed).reduce((s, a) => s + (Number.isInteger(a.amount) ? a.amount : 0), 0);
  if (amount <= 0) return { ok: false, error: "この請求には入金（消込）の記録がないため、領収書を作成できません。領収書は実際の入金額に基づいて作成します。" };
  return { ok: true, amount };
}

// ───────────── 表示形式 ─────────────

export function fmtYen(n: number | null | undefined): FieldValue {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  return `${n.toLocaleString("ja-JP")}円`;
}

export function fmtDate(d: string | null | undefined): FieldValue {
  if (!d) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  if (!m) return d;
  return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日`;
}

export function fmtYm(ym: string | null | undefined): FieldValue {
  if (!ym) return null;
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  return m ? `${Number(m[1])}年${Number(m[2])}月` : ym;
}

export function fmtDateTime(iso: string | null | undefined): FieldValue {
  if (!iso) return null;
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export function fmtNum(n: number | null | undefined, suffix = ""): FieldValue {
  if (n === null || n === undefined) return null;
  return `${n}${suffix}`;
}

/** 空文字は null（未入力）として扱う */
export function s(v: string | null | undefined): FieldValue {
  return v === null || v === undefined || v.trim() === "" ? null : v;
}
