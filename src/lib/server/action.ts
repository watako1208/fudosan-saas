import "server-only";
import { AuthError } from "./session";
import { ConflictError, NotFoundError, ValidationError } from "./repo";

export type ActionResult<T = unknown> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: string;
      errors?: string[];
      fieldErrors?: Record<string, string>;
      code?: "validation" | "conflict" | "forbidden" | "unauthenticated" | "reauth_required" | "not_found" | "server";
      latest?: unknown;
    };

/** サーバーアクションの共通ラッパー。例外を利用者向けの結果に変換する（入力内容はクライアント側で保持される） */
export async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof ValidationError) {
      return { ok: false, code: "validation", error: e.message, errors: e.errors, fieldErrors: e.fieldErrors };
    }
    if (e instanceof ConflictError) {
      return { ok: false, code: "conflict", error: e.message, latest: JSON.parse(JSON.stringify(e.latest)) };
    }
    if (e instanceof AuthError) return { ok: false, code: e.code, error: e.message };
    if (e instanceof NotFoundError) return { ok: false, code: "not_found", error: e.message };
    // ログへ個人情報を出さないよう、メッセージのみ記録
    console.error("[action-error]", e instanceof Error ? e.message : String(e));
    return { ok: false, code: "server", error: "保存に失敗しました。時間をおいて再試行してください。" };
  }
}

/** FormData / オブジェクトの文字列取得ヘルパー */
export function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : v === null || v === undefined ? "" : String(v).trim();
}

export function optStr(v: unknown): string | null {
  const s = str(v);
  return s === "" ? null : s;
}

/** 金額（円・整数）。未入力は null（0 に置き換えない） */
export function optYen(v: unknown, field: string, errs: Record<string, string>): number | null {
  const s = str(v).normalize("NFKC").replace(/[,¥円]/g, "");
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isInteger(n)) {
    errs[field] = "金額は円単位の整数で入力してください";
    return null;
  }
  return n;
}
