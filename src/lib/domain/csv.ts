import Papa from "papaparse";
import iconv from "iconv-lite";
export { safeCell, toCsv } from "./csv-export";

export type CsvEncoding = "utf-8" | "shift_jis";

/** 文字コード判定: BOM / UTF-8として正しく読めるか で判定し、だめなら Shift_JIS */
export function detectEncoding(buf: Uint8Array): CsvEncoding {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return "utf-8";
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return "utf-8";
  } catch {
    return "shift_jis";
  }
}

export function decodeCsv(buf: Uint8Array, enc?: CsvEncoding): { text: string; encoding: CsvEncoding } {
  const encoding = enc ?? detectEncoding(buf);
  const text =
    encoding === "utf-8"
      ? new TextDecoder("utf-8").decode(buf).replace(/^﻿/, "")
      : iconv.decode(Buffer.from(buf), "Shift_JIS");
  return { text, encoding };
}

export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const res = Papa.parse<string[]>(text.trim(), { skipEmptyLines: true });
  const all = res.data as string[][];
  return { headers: all[0] ?? [], rows: all.slice(1) };
}

/** 入金CSV行の正規化。必須: 入金日・金額 */
export function normalizePaymentRow(
  row: string[],
  map: { date: number; amount: number; payer?: number; reference?: number; account?: number },
): { ok: true; value: { date: string; amount: number; payerName: string; reference: string; account: string } } | { ok: false; error: string } {
  const rawDate = (row[map.date] ?? "").trim();
  const rawAmt = (row[map.amount] ?? "").trim();
  const date = normalizeDate(rawDate);
  if (!date) return { ok: false, error: `入金日を読み取れません: "${rawDate}"` };
  const amt = Number(rawAmt.normalize("NFKC").replace(/[,¥円\s]/g, ""));
  if (!Number.isInteger(amt) || amt <= 0) return { ok: false, error: `金額を読み取れません: "${rawAmt}"` };
  const g = (i?: number) => (i === undefined ? "" : (row[i] ?? "").trim());
  return { ok: true, value: { date, amount: amt, payerName: g(map.payer), reference: g(map.reference), account: g(map.account) } };
}

export function normalizeDate(s: string): string | null {
  const t = s.normalize("NFKC").trim();
  let m = /^(\d{4})[/\-.年](\d{1,2})[/\-.月](\d{1,2})日?$/.exec(t);
  if (!m) m = /^(\d{4})(\d{2})(\d{2})$/.exec(t);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** 入金明細の内容指紋（重複候補の検出用。削除判断には使わない） */
export function paymentFingerprint(v: { date: string; amount: number; payerName: string; reference: string }): string {
  return [v.date, v.amount, v.payerName.normalize("NFKC").replace(/\s/g, ""), v.reference].join("|");
}
