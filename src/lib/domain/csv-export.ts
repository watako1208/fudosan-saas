/** CSV出力の安全化: 表計算ソフトで式として解釈される先頭文字を無効化する */
export function safeCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return "﻿" + [headers, ...rows].map((r) => r.map(safeCell).join(",")).join("\r\n") + "\r\n";
}

