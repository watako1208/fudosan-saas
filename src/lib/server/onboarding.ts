"use server";
import { createHash, randomBytes } from "crypto";
import { adminAuth, adminDb } from "./firebase-admin";
import { run, str, ActionResult } from "./action";
import { ValidationError, nowIso, audit, col } from "./repo";
import { requireStaff, requireRecentAuth, Ctx } from "./session";
import { StaffRole, ExternalKind, ROLE_CAPS, Cap } from "@/lib/permissions";
import { DEFAULT_ITEM_TYPES, defaultCompanySettings } from "@/lib/defaults";

const hashCode = async (code: string) =>
  createHash("sha256").update(code.trim().toUpperCase().replace(/[\s-]/g, "")).digest("hex");

/** 新しい会社と最初の会社管理者を登録する */
export async function signupCompany(input: { idToken: string; companyName: string; storeName: string; displayName: string }): Promise<ActionResult<null>> {
  return run(async () => {
    if (process.env.SIGNUP_DISABLED === "1") throw new ValidationError(["新規の会社登録は現在受け付けていません"]);
    const decoded = await adminAuth().verifyIdToken(input.idToken);
    const companyName = str(input.companyName);
    const displayName = str(input.displayName);
    const storeName = str(input.storeName) || "本店";
    const fe: Record<string, string> = {};
    if (!companyName) fe.companyName = "会社名を入力してください";
    if (!displayName) fe.displayName = "氏名を入力してください";
    if (Object.keys(fe).length) throw new ValidationError(Object.values(fe), fe);
    const db = adminDb();
    const userRef = db.collection("users").doc(decoded.uid);
    await db.runTransaction(async (tx) => {
      if ((await tx.get(userRef)).exists) throw new ValidationError(["このアカウントは既に登録済みです"]);
      const companyRef = db.collection("companies").doc();
      const t = nowIso();
      const base = { companyId: companyRef.id, createdAt: t, updatedAt: t, createdBy: decoded.uid, updatedBy: decoded.uid, version: 1, archived: false };
      tx.create(companyRef, { ...base, id: companyRef.id, name: companyName, settings: defaultCompanySettings() });
      const storeRef = companyRef.collection("stores").doc();
      tx.create(storeRef, { ...base, id: storeRef.id, name: storeName });
      tx.create(userRef, {
        companyId: companyRef.id,
        displayName,
        email: decoded.email ?? "",
        kind: "staff",
        roles: ["admin"],
        extraCaps: [],
        storeIds: [storeRef.id],
        partyId: null,
        disabled: false,
        createdAt: t,
      });
      for (const it of DEFAULT_ITEM_TYPES) {
        const r = companyRef.collection("itemTypes").doc(it.code);
        tx.create(r, { ...base, id: it.code, ...it, effectiveFrom: "2000-01-01" });
      }
      const ctx = { uid: decoded.uid, companyId: companyRef.id, user: { displayName } } as Ctx;
      audit(tx, ctx, "company.create", "companies", companyRef.id, { name: companyName });
    });
    return null;
  });
}

/** 招待コードで利用開始する（外部メール連携なしで、管理者がコードを本人へ手渡しする） */
export async function signupWithInvite(input: { idToken: string; code: string; displayName: string }): Promise<ActionResult<{ kind: string }>> {
  return run(async () => {
    const decoded = await adminAuth().verifyIdToken(input.idToken);
    const displayName = str(input.displayName);
    if (!displayName) throw new ValidationError(["氏名を入力してください"], { displayName: "氏名を入力してください" });
    const db = adminDb();
    const codeRef = db.collection("inviteCodes").doc(await hashCode(input.code));
    const userRef = db.collection("users").doc(decoded.uid);
    return db.runTransaction(async (tx) => {
      const c = await tx.get(codeRef);
      if (!c.exists) throw new ValidationError(["招待コードが正しくありません"], { code: "招待コードが正しくありません" });
      const inv = c.data()!;
      if (inv.usedBy) throw new ValidationError(["この招待コードは使用済みです"], { code: "この招待コードは使用済みです" });
      if (inv.revoked) throw new ValidationError(["この招待コードは無効化されています"], { code: "無効化されています" });
      if (inv.expiresAt < nowIso()) throw new ValidationError(["招待コードの有効期限が切れています"], { code: "有効期限切れです" });
      if ((await tx.get(userRef)).exists) throw new ValidationError(["このアカウントは既に登録済みです"]);
      tx.create(userRef, {
        companyId: inv.companyId,
        displayName,
        email: decoded.email ?? "",
        kind: inv.kind,
        roles: inv.roles ?? [],
        extraCaps: inv.extraCaps ?? [],
        storeIds: inv.storeIds ?? [],
        partyId: inv.partyId ?? null,
        disabled: false,
        createdAt: nowIso(),
      });
      tx.update(codeRef, { usedBy: decoded.uid, usedAt: nowIso() });
      const ctx = { uid: decoded.uid, companyId: inv.companyId, user: { displayName } } as Ctx;
      audit(tx, ctx, "invite.accept", "users", decoded.uid, { kind: inv.kind, roles: inv.roles });
      return { kind: inv.kind as string };
    });
  });
}

/** 管理者: 招待コード発行（社内利用者・外部利用者共通） */
export async function issueInviteCode(input: {
  kind: "staff" | ExternalKind;
  roles?: StaffRole[];
  extraCaps?: Cap[];
  storeIds?: string[];
  partyId?: string | null;
  label: string;
  validDays?: number;
}): Promise<ActionResult<{ code: string; expiresAt: string }>> {
  return run(async () => {
    const ctx = await requireStaff();
    // 外部利用者の招待は担当業務の権限で、社内利用者の招待は管理者のみ
    if (input.kind === "staff") {
      if (!ctx.caps.has("settings.manage")) throw new ValidationError(["社内利用者の招待は会社管理者のみ行えます"]);
      requireRecentAuth(ctx);
      const valid = Object.keys(ROLE_CAPS);
      if (!input.roles?.length || input.roles.some((r) => !valid.includes(r))) throw new ValidationError(["権限を1つ以上選択してください"]);
    } else {
      if (!input.partyId) throw new ValidationError(["外部利用者には紐づく顧客・関係者を指定してください"]);
      const p = await col(ctx.companyId, "parties").doc(input.partyId).get();
      if (!p.exists || p.data()!.companyId !== ctx.companyId) throw new ValidationError(["関係者が見つかりません"]);
    }
    const raw = randomBytes(8).toString("hex").toUpperCase().slice(0, 12);
    const code = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
    const expiresAt = new Date(Date.now() + (input.validDays ?? 7) * 86400000).toISOString();
    const db = adminDb();
    await db.runTransaction(async (tx) => {
      const id = await hashCode(code);
      tx.create(db.collection("inviteCodes").doc(id), {
        id,
        companyId: ctx.companyId,
        kind: input.kind,
        roles: input.kind === "staff" ? input.roles : [],
        extraCaps: input.kind === "staff" ? (input.extraCaps ?? []) : [],
        storeIds: input.storeIds ?? [],
        partyId: input.partyId ?? null,
        label: str(input.label),
        expiresAt,
        createdAt: nowIso(),
        createdBy: ctx.uid,
        usedBy: null,
        revoked: false,
      });
      audit(tx, ctx, "invite.issue", "inviteCodes", id, { kind: input.kind, roles: input.roles, label: input.label });
    });
    return { code, expiresAt };
  });
}

export async function revokeInviteCode(id: string): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff();
    const db = adminDb();
    await db.runTransaction(async (tx) => {
      const r = db.collection("inviteCodes").doc(id);
      const s = await tx.get(r);
      if (!s.exists || s.data()!.companyId !== ctx.companyId) throw new ValidationError(["招待コードが見つかりません"]);
      if (s.data()!.kind === "staff" && !ctx.caps.has("settings.manage")) throw new ValidationError(["権限がありません"]);
      tx.update(r, { revoked: true });
      audit(tx, ctx, "invite.revoke", "inviteCodes", id);
    });
    return null;
  });
}

