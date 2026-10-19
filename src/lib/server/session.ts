import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { adminAuth, adminDb } from "./firebase-admin";
import { Cap, ExternalKind, StaffRole, capsOf } from "@/lib/permissions";

export const SESSION_COOKIE = "__session";
export const SESSION_DAYS = 5;

/** users/{uid} の内容 */
export interface UserProfile {
  uid: string;
  companyId: string;
  displayName: string;
  email: string;
  kind: "staff" | ExternalKind;
  roles: StaffRole[];
  extraCaps: Cap[];
  storeIds: string[];
  /** 外部利用者が紐づく人・法人 */
  partyId?: string | null;
  disabled?: boolean;
}

export interface Ctx {
  uid: string;
  companyId: string;
  user: UserProfile;
  caps: Set<Cap>;
  authTime: number; // 秒
  isStaff: boolean;
}

export class AuthError extends Error {
  constructor(
    message: string,
    public code: "unauthenticated" | "forbidden" | "reauth_required" = "forbidden",
  ) {
    super(message);
  }
}

export const getCtx = cache(async (): Promise<Ctx | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const decoded = await adminAuth().verifySessionCookie(token, true);
    const snap = await adminDb().collection("users").doc(decoded.uid).get();
    if (!snap.exists) return null;
    const user = { uid: decoded.uid, ...(snap.data() as Omit<UserProfile, "uid">) };
    if (user.disabled) return null;
    const isStaff = user.kind === "staff";
    return {
      uid: decoded.uid,
      companyId: user.companyId,
      user,
      caps: isStaff ? capsOf(user.roles ?? [], user.extraCaps ?? []) : new Set(),
      authTime: decoded.auth_time,
      isStaff,
    };
  } catch {
    return null;
  }
});

/** 画面用: 未ログインならログインへ、外部利用者は外部ページへ */
export async function requireStaffPage(cap?: Cap): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx) redirect("/login");
  if (!ctx.isStaff) redirect("/portal");
  if (cap && !ctx.caps.has(cap)) redirect(`/forbidden?cap=${encodeURIComponent(cap)}`);
  return ctx;
}

/** サーバー処理用: 権限がなければ例外 */
export async function requireStaff(cap?: Cap): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx) throw new AuthError("ログインが必要です", "unauthenticated");
  if (!ctx.isStaff) throw new AuthError("この操作を行う権限がありません");
  if (cap && !ctx.caps.has(cap)) throw new AuthError("この操作を行う権限がありません");
  return ctx;
}

export async function requireExternal(): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx) throw new AuthError("ログインが必要です", "unauthenticated");
  if (ctx.isStaff) throw new AuthError("外部利用者専用の操作です");
  return ctx;
}

/** 重要操作の再認証（直近10分以内にパスワード入力を求める） */
export function requireRecentAuth(ctx: Ctx, withinSec = 600) {
  if (Date.now() / 1000 - ctx.authTime > withinSec) {
    throw new AuthError("重要な操作のため、もう一度ログインしてください", "reauth_required");
  }
}

/** 店舗スコープ: 管理者以外は所属店舗のデータのみ */
export function canAccessStore(ctx: Ctx, storeId: string | null | undefined): boolean {
  if (ctx.user.roles.includes("admin")) return true;
  if (!storeId) return true; // 店舗未設定のデータは会社内共有
  return ctx.user.storeIds.includes(storeId);
}

/** 上部の店舗切替で選択中の店舗（空=すべて）。権限外の店舗は無視する */
export async function currentStoreId(ctx: Ctx): Promise<string | null> {
  const v = (await cookies()).get("store")?.value || null;
  if (!v) return null;
  return canAccessStore(ctx, v) ? v : null;
}
