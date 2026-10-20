import "server-only";
import { FieldValue, Query, Transaction, DocumentReference } from "firebase-admin/firestore";
import { adminDb } from "./firebase-admin";
import { Ctx, AuthError } from "./session";

// すべての業務データは companies/{companyId}/{collection}/{id} に保存し、会社ごとに分離する。
// クライアントからの Firestore 直接アクセスはルールで全面禁止し、必ずこのサーバー層を経由する。

export interface BaseDoc {
  id: string;
  companyId: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  version: number;
  archived?: boolean;
}

export class ValidationError extends Error {
  constructor(
    public errors: string[],
    public fieldErrors: Record<string, string> = {},
  ) {
    super(errors[0] ?? "入力内容を確認してください");
  }
}

export class ConflictError extends Error {
  constructor(public latest: unknown) {
    super("他の利用者が先に更新しました");
  }
}

export class NotFoundError extends Error {
  constructor() {
    super("対象のデータが見つからないか、閲覧権限がありません");
  }
}

export const nowIso = () => new Date().toISOString();

export function col(companyId: string, name: string) {
  if (!companyId) throw new AuthError("会社が特定できません", "unauthenticated");
  return adminDb().collection("companies").doc(companyId).collection(name);
}

export function ref(ctx: Ctx, name: string, id: string): DocumentReference {
  if (!id || id.includes("/")) throw new NotFoundError();
  return col(ctx.companyId, name).doc(id);
}

export async function getDoc<T extends BaseDoc>(ctx: Ctx, name: string, id: string): Promise<T | null> {
  if (!id || id.includes("/")) return null;
  const snap = await ref(ctx, name, id).get();
  if (!snap.exists) return null;
  const d = snap.data() as T;
  // 二重確認: パスと companyId フィールドが一致しなければ返さない（T13）
  if (d.companyId !== ctx.companyId) return null;
  return { ...d, id: snap.id };
}

export async function mustGet<T extends BaseDoc>(ctx: Ctx, name: string, id: string): Promise<T> {
  const d = await getDoc<T>(ctx, name, id);
  if (!d) throw new NotFoundError();
  return d;
}

export async function txGet<T extends BaseDoc>(tx: Transaction, ctx: Ctx, name: string, id: string): Promise<T> {
  const snap = await tx.get(ref(ctx, name, id));
  if (!snap.exists) throw new NotFoundError();
  const d = snap.data() as T;
  if (d.companyId !== ctx.companyId) throw new NotFoundError();
  return { ...d, id: snap.id };
}

export type Where = [string, FirebaseFirestore.WhereFilterOp, unknown];

export interface ListOpts {
  where?: Where[];
  orderBy?: string;
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
  includeArchived?: boolean;
  /** 名称・番号・住所などの部分一致検索（keywords フィールドを使用） */
  search?: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listDocs<T extends BaseDoc>(ctx: Ctx, name: string, opts: ListOpts = {}): Promise<Page<T>> {
  const pageSize = [25, 50, 100].includes(opts.pageSize ?? 0) ? opts.pageSize! : 50;
  const page = Math.max(1, opts.page ?? 1);
  const sk = searchKey(opts.search);
  if (sk) {
    // 検索時: キーワード1つで候補を絞り、残りの条件はサーバー側で絞り込む（最大1000件）
    const snap = await col(ctx.companyId, name).where("keywords", "array-contains", sk.first).limit(1000).get();
    let all = snap.docs.map((d) => ({ ...(d.data() as T), id: d.id }));
    all = all.filter((d) => {
      const kw = (d as unknown as { keywords?: string[] }).keywords ?? [];
      if (!sk.rest.every((k) => kw.includes(k))) return false;
      if (!opts.includeArchived && d.archived) return false;
      return (opts.where ?? []).every(([f, op, v]) => matchWhere((d as unknown as Record<string, unknown>)[f], op, v));
    });
    const key = opts.orderBy ?? "updatedAt";
    const dir = opts.dir === "asc" ? 1 : -1;
    all.sort((a, b) => {
      const x = (a as unknown as Record<string, string>)[key] ?? "";
      const y = (b as unknown as Record<string, string>)[key] ?? "";
      return x < y ? -dir : x > y ? dir : 0;
    });
    return { items: all.slice((page - 1) * pageSize, page * pageSize), total: all.length, page, pageSize };
  }
  let q: Query = col(ctx.companyId, name);
  for (const [f, op, v] of opts.where ?? []) q = q.where(f, op, v);
  if (!opts.includeArchived) q = q.where("archived", "==", false);
  const total = (await q.count().get()).data().count;
  const key = opts.orderBy ?? "updatedAt";
  try {
    const snap = await q.orderBy(key, opts.dir ?? "desc").offset((page - 1) * pageSize).limit(pageSize).get();
    return { items: snap.docs.map((d) => ({ ...(d.data() as T), id: d.id })), total, page, pageSize };
  } catch (e) {
    // 複合インデックスが無い組合せ（9 = FAILED_PRECONDITION）は、等価条件のみで取得してサーバー側で並べ替える（最大2000件）
    if ((e as { code?: number }).code !== 9) throw e;
    const snap = await q.limit(2000).get();
    const dir = opts.dir === "asc" ? 1 : -1;
    const all = snap.docs
      .map((d) => ({ ...(d.data() as T), id: d.id }))
      .sort((a, b) => {
        const x = (a as unknown as Record<string, string | number>)[key] ?? "";
        const y = (b as unknown as Record<string, string | number>)[key] ?? "";
        return x < y ? -dir : x > y ? dir : 0;
      });
    return { items: all.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize };
  }
}

function matchWhere(a: unknown, op: FirebaseFirestore.WhereFilterOp, v: unknown): boolean {
  switch (op) {
    case "==": return a === v;
    case "!=": return a !== v;
    case "in": return Array.isArray(v) && v.includes(a);
    case "array-contains": return Array.isArray(a) && a.includes(v);
    case ">=": return (a as string) >= (v as string);
    case "<=": return (a as string) <= (v as string);
    case ">": return (a as string) > (v as string);
    case "<": return (a as string) < (v as string);
    default: return true;
  }
}

/** 少量の関連データ取得用（上限付き） */
export async function findDocs<T extends BaseDoc>(ctx: Ctx, name: string, where: Where[], limit = 500): Promise<T[]> {
  let q: Query = col(ctx.companyId, name);
  for (const [f, op, v] of where) q = q.where(f, op, v);
  const snap = await q.limit(limit).get();
  return snap.docs.map((d) => ({ ...(d.data() as T), id: d.id }));
}

export async function getMany<T extends BaseDoc>(ctx: Ctx, name: string, ids: string[]): Promise<Map<string, T>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  const out = new Map<string, T>();
  if (!uniq.length) return out;
  const snaps = await adminDb().getAll(...uniq.map((id) => ref(ctx, name, id)));
  for (const s of snaps) if (s.exists && s.data()!.companyId === ctx.companyId) out.set(s.id, { ...(s.data() as T), id: s.id });
  return out;
}

export function baseFields(ctx: Ctx) {
  const t = nowIso();
  return { companyId: ctx.companyId, createdAt: t, updatedAt: t, createdBy: ctx.uid, updatedBy: ctx.uid, version: 1, archived: false };
}

/** トランザクション内で新規作成 */
export function txCreate<T extends object>(tx: Transaction, ctx: Ctx, name: string, data: T, id?: string): string {
  const r = id ? ref(ctx, name, id) : col(ctx.companyId, name).doc();
  tx.create(r, { ...data, ...baseFields(ctx), id: r.id });
  return r.id;
}

/** 楽観的排他制御付き更新（同時編集の検知: T15） */
export function txUpdate(
  tx: Transaction,
  ctx: Ctx,
  name: string,
  current: BaseDoc,
  expectedVersion: number | null,
  patch: Record<string, unknown>,
) {
  if (expectedVersion !== null && current.version !== expectedVersion) throw new ConflictError(current);
  tx.update(ref(ctx, name, current.id), {
    ...patch,
    updatedAt: nowIso(),
    updatedBy: ctx.uid,
    version: (current.version ?? 0) + 1,
  });
}

export async function createDoc<T extends object>(ctx: Ctx, name: string, data: T, auditAction = "create"): Promise<string> {
  return adminDb().runTransaction(async (tx) => {
    const id = txCreate(tx, ctx, name, data);
    audit(tx, ctx, auditAction, name, id, data);
    return id;
  });
}

export async function updateDoc(
  ctx: Ctx,
  name: string,
  id: string,
  expectedVersion: number | null,
  patch: Record<string, unknown>,
  auditAction = "update",
): Promise<void> {
  await adminDb().runTransaction(async (tx) => {
    const cur = await txGet(tx, ctx, name, id);
    txUpdate(tx, ctx, name, cur, expectedVersion, patch);
    audit(tx, ctx, auditAction, name, id, diff(cur as unknown as Record<string, unknown>, patch));
  });
}

/** 操作記録（業務利用者は変更・削除不可。ルールでも書込み禁止） */
export function audit(tx: Transaction, ctx: Ctx, action: string, entity: string, entityId: string, detail?: unknown) {
  const r = col(ctx.companyId, "auditLogs").doc();
  tx.create(r, {
    id: r.id,
    companyId: ctx.companyId,
    at: nowIso(),
    uid: ctx.uid,
    userName: ctx.user.displayName,
    action,
    entity,
    entityId,
    detail: redact(detail),
  });
}

const SENSITIVE_KEYS = /password|token|secret|idDocument|identity|myNumber|passport/i;
function redact(v: unknown, depth = 0): unknown {
  if (depth > 4 || v === null || v === undefined) return v ?? null;
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => redact(x, depth + 1));
  if (typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = SENSITIVE_KEYS.test(k) ? "[非表示]" : redact(x, depth + 1);
    return o;
  }
  if (typeof v === "string" && v.length > 500) return v.slice(0, 500) + "…";
  return v;
}

function diff(before: Record<string, unknown>, patch: Record<string, unknown>) {
  const out: Record<string, { before: unknown; after: unknown }> = {};
  for (const k of Object.keys(patch)) {
    if (JSON.stringify(before[k]) !== JSON.stringify(patch[k])) out[k] = { before: before[k] ?? null, after: patch[k] ?? null };
  }
  return out;
}

/**
 * 二重送信防止: 処理識別番号(requestId)ごとに一度だけ実行する。
 * 結果はトランザクションと同時に保存されるため、再試行時は前回結果を返す。
 */
export async function runOnce<R>(ctx: Ctx, requestId: string, fn: (tx: Transaction) => Promise<R>): Promise<R> {
  if (!requestId || requestId.length > 100 || requestId.includes("/")) throw new ValidationError(["処理識別番号が不正です"]);
  const r = col(ctx.companyId, "idempotency").doc(requestId);
  return adminDb().runTransaction(async (tx) => {
    const s = await tx.get(r);
    if (s.exists) return s.data()!.result as R;
    const result = await fn(tx);
    tx.create(r, { id: requestId, companyId: ctx.companyId, at: nowIso(), uid: ctx.uid, result: result ?? null });
    return result;
  });
}

/** 画面表示用の連番（物件番号・契約番号など）。トランザクション内で採番する */
export async function txNextNumber(tx: Transaction, ctx: Ctx, seq: string, prefix: string, width = 6): Promise<string> {
  const r = col(ctx.companyId, "sequences").doc(seq);
  const s = await tx.get(r);
  const n = (s.exists ? (s.data()!.value as number) : 0) + 1;
  tx.set(r, { companyId: ctx.companyId, value: n }, { merge: true });
  return `${prefix}${String(n).padStart(width, "0")}`;
}

/** 検索用の2文字分割キーワード（Firestoreに全文検索がないため） */
export function keywords(...parts: (string | null | undefined)[]): string[] {
  const set = new Set<string>();
  for (const p of parts) {
    if (!p) continue;
    const s = p.normalize("NFKC").toLowerCase().replace(/[\s　\-ー－,、。・()（）]/g, "");
    if (s.length === 1) set.add(s);
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    if (s.length <= 30) set.add(s);
  }
  return [...set].slice(0, 300);
}

/** 検索語から最初のキーワード（クエリ用）と残り（絞込み用）を作る */
export function searchKey(q: string | undefined): { first: string; rest: string[] } | null {
  const k = keywords(q ?? "").filter((x) => x.length === 2 || (q ?? "").normalize("NFKC").trim().length === 1);
  if (!k.length) return null;
  return { first: k[0], rest: k.slice(1) };
}

export const increment = FieldValue.increment;
