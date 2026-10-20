// ブロック入力の検証・正規化（純粋関数）
import type { DocBlock } from "@/lib/types";
import type { XBlock } from "./engine";

const MAX_BLOCKS = 500;
const MAX_TEXT = 20000;
const MAX_COLS = 30;
const MAX_ROWS = 3000;

function str(v: unknown, max = MAX_TEXT): string {
  const x = typeof v === "string" ? v : v === null || v === undefined ? "" : String(v);
  return x.slice(0, max);
}

/** 画面から送られたブロック配列を検証して正規化する。errors に理由を積む */
export function sanitizeBlocks(raw: unknown, errors: string[], opts: { allowSource: boolean; allowedImages?: Set<string> | null }): XBlock[] {
  let arr: unknown;
  try {
    arr = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    errors.push("編集内容を読み取れませんでした");
    return [];
  }
  if (!Array.isArray(arr)) {
    errors.push("編集内容の形式が正しくありません");
    return [];
  }
  if (arr.length > MAX_BLOCKS) errors.push(`ブロックは${MAX_BLOCKS}個までです`);
  const out: XBlock[] = [];
  const keys = new Set<string>();
  arr.slice(0, MAX_BLOCKS).forEach((b0, i) => {
    const b = (b0 ?? {}) as Record<string, unknown>;
    let key = typeof b.key === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(b.key) ? b.key : `m${i}-${Math.random().toString(36).slice(2, 8)}`;
    if (keys.has(key)) key = `${key}-${i}`;
    keys.add(key);
    const tpl = typeof b.tpl === "number" && Number.isInteger(b.tpl) && b.tpl >= 0 ? b.tpl : null;
    let blk: DocBlock | null = null;
    switch (b.type) {
      case "heading": {
        const level = [1, 2, 3].includes(Number(b.level)) ? (Number(b.level) as 1 | 2 | 3) : 2;
        blk = { type: "heading", text: str(b.text, 500), level };
        break;
      }
      case "paragraph":
        blk = { type: "paragraph", text: str(b.text) };
        break;
      case "table": {
        const columns = Array.isArray(b.columns) ? b.columns.slice(0, MAX_COLS).map((c) => str(c, 500)) : [];
        if (columns.length === 0) {
          errors.push(`${i + 1}番目の表に列がありません`);
          return;
        }
        const rows = Array.isArray(b.rows)
          ? b.rows.slice(0, MAX_ROWS).map((r) => {
              const cells = Array.isArray(r) ? r.map((c) => str(c, 2000)) : [];
              return columns.map((_, ci) => cells[ci] ?? "");
            })
          : [];
        const source = opts.allowSource && typeof b.source === "string" && /^[a-zA-Z0-9_.]{1,60}$/.test(b.source) ? b.source : undefined;
        blk = source ? { type: "table", columns, rows, source } : { type: "table", columns, rows };
        break;
      }
      case "image": {
        const attachmentId = str(b.attachmentId, 100);
        if (!attachmentId || attachmentId.includes("/")) {
          errors.push(`${i + 1}番目の画像が選択されていません`);
          return;
        }
        if (opts.allowedImages && !opts.allowedImages.has(attachmentId)) {
          errors.push(`${i + 1}番目の画像は関連する資料に登録されたものを選択してください`);
          return;
        }
        const w = Number(b.widthPct);
        blk = { type: "image", attachmentId, ...(b.caption ? { caption: str(b.caption, 500) } : {}), ...(Number.isFinite(w) && w >= 10 && w <= 100 ? { widthPct: Math.round(w) } : {}) };
        break;
      }
      case "pagebreak":
        blk = { type: "pagebreak" };
        break;
      case "spacer": {
        const h = Number(b.height);
        blk = { type: "spacer", height: Number.isFinite(h) ? Math.min(200, Math.max(4, Math.round(h))) : 12 };
        break;
      }
      default:
        errors.push(`${i + 1}番目のブロックの種類が正しくありません`);
        return;
    }
    out.push({ ...blk, key, tpl } as XBlock);
  });
  return out;
}

/** 必須項目の入力（改行・カンマ区切り） */
export function parseRequiredFields(v: unknown): string[] {
  return [...new Set(str(v, 5000).split(/[\s,、]+/).map((x) => x.trim()).filter((x) => /^[a-zA-Z0-9_.]{1,80}$/.test(x)))].slice(0, 100);
}
