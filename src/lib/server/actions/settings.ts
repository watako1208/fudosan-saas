"use server";
import { adminAuth, adminDb } from "../firebase-admin";
import { requireStaff, requireRecentAuth } from "../session";
import { run, str, optStr, ActionResult } from "../action";
import { ValidationError, txGet, txCreate, txUpdate, audit, col, nowIso, BaseDoc } from "../repo";
import { C, Store, ItemTypeDoc } from "@/lib/types";
import { ROLE_CAPS, GRANTABLE_CAPS, StaffRole, Cap } from "@/lib/permissions";
import { isValidBizDate, todayJst } from "@/lib/domain/dates";
import type { Rounding, ProrationMethod, TaxCategory } from "@/lib/domain/money";

const ROUNDINGS: Rounding[] = ["floor", "round", "ceil"];
const PRORATIONS: ProrationMethod[] = ["actual", "fixed30", "none"];

function intIn(v: unknown, min: number, max: number, field: string, label: string, fe: Record<string, string>): number {
  const n = Number(str(v));
  if (!Number.isInteger(n) || n < min || n > max) {
    fe[field] = `${label}は${min}〜${max}の整数で入力してください`;
    return min;
  }
  return n;
}

/**
 * 会社設定の変更。適用開始日つきの履歴（settingsHistory）として保存し、
 * 適用開始日が到来した時点から有効にする（過去の確定計算・確定済み請求は再計算しない）。
 */
export async function updateCompanySettings(v: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff("settings.manage");
    requireRecentAuth(ctx);
    const fe: Record<string, string> = {};
    const name = str(v.name);
    if (!name) fe.name = "会社名を入力してください";
    const taxRounding = str(v.taxRounding) as Rounding;
    const lineRounding = str(v.lineRounding) as Rounding;
    const prorationMethod = str(v.prorationMethod) as ProrationMethod;
    const prorationRounding = str(v.prorationRounding) as Rounding;
    if (!ROUNDINGS.includes(taxRounding)) fe.taxRounding = "端数処理を選択してください";
    if (!ROUNDINGS.includes(lineRounding)) fe.lineRounding = "端数処理を選択してください";
    if (!PRORATIONS.includes(prorationMethod)) fe.prorationMethod = "日割り方式を選択してください";
    if (!ROUNDINGS.includes(prorationRounding)) fe.prorationRounding = "端数処理を選択してください";
    const fileMaxMB = intIn(v.fileMaxMB, 1, 30, "fileMaxMB", "1ファイルの上限", fe);
    const fileMaxCount = intIn(v.fileMaxCount, 1, 50, "fileMaxCount", "1回の登録件数", fe);
    const today = todayJst();
    const effectiveFrom = str(v.effectiveFrom) || today;
    if (!isValidBizDate(effectiveFrom)) fe.effectiveFrom = "適用開始日は YYYY-MM-DD 形式で入力してください";
    else if (effectiveFrom < today) fe.effectiveFrom = "適用開始日に過去の日付は指定できません（過去の確定計算を変えないため）";
    if (Object.keys(fe).length) throw new ValidationError(Object.values(fe), fe);
    const calc = { taxRounding, lineRounding, defaultProration: { method: prorationMethod, rounding: prorationRounding }, fileMaxMB, fileMaxCount };
    const db = adminDb();
    const companyRef = db.collection("companies").doc(ctx.companyId);
    await db.runTransaction(async (tx) => {
      const cs = await tx.get(companyRef);
      if (!cs.exists) throw new ValidationError(["会社が見つかりません"]);
      const prev = (cs.data()!.settings ?? {}) as Record<string, unknown>;
      const applyNow = effectiveFrom <= today;
      const h = col(ctx.companyId, "settingsHistory").doc();
      tx.create(h, {
        id: h.id, companyId: ctx.companyId, effectiveFrom, settings: calc,
        previous: { taxRounding: prev.taxRounding ?? null, lineRounding: prev.lineRounding ?? null, defaultProration: prev.defaultProration ?? null, fileMaxMB: prev.fileMaxMB ?? null, fileMaxCount: prev.fileMaxCount ?? null },
        status: applyNow ? "applied" : "scheduled", appliedAt: applyNow ? nowIso() : null, at: nowIso(), by: ctx.uid, byName: ctx.user.displayName,
      });
      const patch: Record<string, unknown> = { name, updatedAt: nowIso(), updatedBy: ctx.uid };
      if (applyNow) {
        // closedThrough など他の設定は保持する（項目単位で更新）
        patch["settings.taxRounding"] = taxRounding;
        patch["settings.lineRounding"] = lineRounding;
        patch["settings.defaultProration"] = calc.defaultProration;
        patch["settings.fileMaxMB"] = fileMaxMB;
        patch["settings.fileMaxCount"] = fileMaxCount;
        patch["settings.effectiveFrom"] = effectiveFrom;
      }
      tx.update(companyRef, patch);
      audit(tx, ctx, applyNow ? "settings.update" : "settings.schedule", "companies", ctx.companyId, { name, effectiveFrom, ...calc });
    });
    return null;
  });
}

/** 写真・資料の分類一覧 */
export async function updateAttachmentCategories(v: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff("settings.manage");
    const list = [...new Set(str(v.categories).split(/\r?\n/).map((s) => s.trim()).filter(Boolean))].slice(0, 60).map((s) => s.slice(0, 30));
    if (!list.length) throw new ValidationError(["分類を1つ以上入力してください"], { categories: "分類を1つ以上入力してください" });
    const db = adminDb();
    await db.runTransaction(async (tx) => {
      const r = db.collection("companies").doc(ctx.companyId);
      const before = (await tx.get(r)).data()?.settings?.attachmentCategories ?? null;
      tx.update(r, { "settings.attachmentCategories": list, updatedAt: nowIso(), updatedBy: ctx.uid });
      audit(tx, ctx, "settings.categories", "companies", ctx.companyId, { before, after: list });
    });
    return null;
  });
}

// ───────────── 店舗 ─────────────

function storeFields(v: Record<string, unknown>) {
  const fe: Record<string, string> = {};
  const name = str(v.name);
  if (!name) fe.name = "店舗名を入力してください";
  return { fe, data: { name, address: optStr(v.address), phone: optStr(v.phone) } };
}

export async function createStore(v: Record<string, unknown>): Promise<ActionResult<{ redirect: string }>> {
  return run(async () => {
    const ctx = await requireStaff("settings.manage");
    const { fe, data } = storeFields(v);
    if (Object.keys(fe).length) throw new ValidationError(Object.values(fe), fe);
    await adminDb().runTransaction(async (tx) => {
      const id = txCreate(tx, ctx, C.stores, data satisfies Omit<Store, keyof BaseDoc>);
      audit(tx, ctx, "create", C.stores, id, data);
    });
    return { redirect: "/settings?tab=stores" };
  });
}

export async function updateStore(id: string, v: Record<string, unknown>): Promise<ActionResult<{ redirect: string }>> {
  return run(async () => {
    const ctx = await requireStaff("settings.manage");
    const { fe, data } = storeFields(v);
    if (Object.keys(fe).length) throw new ValidationError(Object.values(fe), fe);
    await adminDb().runTransaction(async (tx) => {
      const cur = await txGet<Store>(tx, ctx, C.stores, id);
      txUpdate(tx, ctx, C.stores, cur, v._version === null || v._version === undefined ? null : Number(v._version), data);
      audit(tx, ctx, "update", C.stores, id, data);
    });
    return { redirect: "/settings?tab=stores" };
  });
}

export async function archiveStore(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff("settings.manage");
    await adminDb().runTransaction(async (tx) => {
      const cur = await txGet<Store>(tx, ctx, C.stores, str(input.id));
      txUpdate(tx, ctx, C.stores, cur, null, { archived: !cur.archived });
      audit(tx, ctx, cur.archived ? "unarchive" : "archive", C.stores, cur.id);
    });
    return null;
  });
}

// ───────────── 利用者 ─────────────

/** 権限・所属店舗・利用停止の変更（重要操作のため再認証が必要） */
export async function updateUserAccess(v: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff("settings.manage");
    requireRecentAuth(ctx);
    const uid = str(v.uid);
    const arr = (x: unknown) => (Array.isArray(x) ? x.map(String) : x === undefined || x === null || x === "" ? [] : [String(x)]);
    const roles = arr(v.roles).filter((r) => r in ROLE_CAPS) as StaffRole[];
    const extraCaps = arr(v.extraCaps).filter((c) => GRANTABLE_CAPS.includes(c as Cap)) as Cap[];
    const storeIds = arr(v.storeIds);
    const disabled = v.disabled === true || v.disabled === "true" || v.disabled === "on";
    const db = adminDb();
    const r = db.collection("users").doc(uid);
    const validStores = new Set((await col(ctx.companyId, C.stores).select().limit(500).get()).docs.map((d) => d.id));
    if (storeIds.some((s) => !validStores.has(s))) throw new ValidationError(["存在しない店舗が含まれています"]);
    await db.runTransaction(async (tx) => {
      const s = await tx.get(r);
      if (!s.exists || s.data()!.companyId !== ctx.companyId) throw new ValidationError(["利用者が見つかりません"]);
      const u = s.data()!;
      const patch: Record<string, unknown> = { disabled, updatedAt: nowIso(), updatedBy: ctx.uid };
      if (u.kind === "staff") {
        if (!roles.length) throw new ValidationError(["権限を1つ以上選択してください"]);
        Object.assign(patch, { roles, extraCaps, storeIds });
      }
      if (uid === ctx.uid && (disabled || !roles.includes("admin"))) throw new ValidationError(["自分自身の会社管理者権限の解除・利用停止はできません"]);
      tx.update(r, patch);
      audit(tx, ctx, "user.access", "users", uid, { before: { roles: u.roles, extraCaps: u.extraCaps, storeIds: u.storeIds, disabled: !!u.disabled }, after: patch });
    });
    if (disabled) {
      // 利用停止時は既存のログイン状態を無効化する
      try {
        await adminAuth().revokeRefreshTokens(uid);
      } catch (e) {
        console.error("[user.revoke]", (e as Error).message);
      }
    }
    return null;
  });
}

// ───────────── 費目（適用開始日つきの版） ─────────────

const TAX_CATS: TaxCategory[] = ["taxable", "exempt", "non_taxable"];

function itemTypeCalcFields(v: Record<string, unknown>, fe: Record<string, string>) {
  const category = str(v.taxCategory) as TaxCategory;
  if (!TAX_CATS.includes(category)) fe.taxCategory = "税区分を選択してください";
  const rate = category === "taxable" ? str(v.taxRate) || "0.10" : "0";
  if (!/^0(\.\d+)?$/.test(rate)) fe.taxRate = "税率は 0.10 のように入力してください";
  const priceMode = str(v.priceMode) === "inclusive" ? "inclusive" : "exclusive";
  const method = str(v.prorationMethod) as ProrationMethod;
  if (!PRORATIONS.includes(method)) fe.prorationMethod = "日割り方式を選択してください";
  const rounding = (str(v.prorationRounding) || "floor") as Rounding;
  if (!ROUNDINGS.includes(rounding)) fe.prorationRounding = "端数処理を選択してください";
  const today = todayJst();
  const effectiveFrom = str(v.effectiveFrom) || today;
  if (!isValidBizDate(effectiveFrom)) fe.effectiveFrom = "適用開始日は YYYY-MM-DD 形式で入力してください";
  else if (effectiveFrom < today) fe.effectiveFrom = "適用開始日に過去の日付は指定できません";
  return {
    tax: { category, rate, priceMode } as ItemTypeDoc["tax"],
    proration: { method, rounding } as ItemTypeDoc["proration"],
    effectiveFrom,
  };
}

export async function createItemType(v: Record<string, unknown>): Promise<ActionResult<{ redirect: string }>> {
  return run(async () => {
    const ctx = await requireStaff("settings.manage");
    const fe: Record<string, string> = {};
    const code = str(v.code);
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(code)) fe.code = "コードは英小文字・数字・_ で2〜40文字（先頭は英字）";
    const name = str(v.name);
    if (!name) fe.name = "費目名を入力してください";
    const kind = str(v.kind) as ItemTypeDoc["kind"];
    if (!["monthly", "initial", "one_time", "deposit"].includes(kind)) fe.kind = "種類を選択してください";
    const calc = itemTypeCalcFields(v, fe);
    if (Object.keys(fe).length) throw new ValidationError(Object.values(fe), fe);
    await adminDb().runTransaction(async (tx) => {
      const r = col(ctx.companyId, C.itemTypes).doc(code);
      if ((await tx.get(r)).exists) throw new ValidationError(["同じコードの費目が既にあります"], { code: "使用済みのコードです" });
      txCreate(tx, ctx, C.itemTypes, {
        code, name, kind, ...calc,
        managementFeeTarget: v.managementFeeTarget === true || v.managementFeeTarget === "on",
        isDeposit: kind === "deposit",
        sort: Number(v.sort) || 500,
      } satisfies Omit<ItemTypeDoc, keyof BaseDoc>, code);
      audit(tx, ctx, "create", C.itemTypes, code, { name, kind, ...calc });
    });
    return { redirect: "/settings?tab=items" };
  });
}

/**
 * 費目の税区分・日割り設定の変更。旧設定は itemTypeVersions に版として残し、
 * 費目には新しい設定と適用開始日を保存する。契約版は作成時の設定を保持するため過去の計算は変わらない。
 */
export async function reviseItemType(v: Record<string, unknown>): Promise<ActionResult<{ redirect: string }>> {
  return run(async () => {
    const ctx = await requireStaff("settings.manage");
    const fe: Record<string, string> = {};
    const calc = itemTypeCalcFields(v, fe);
    const name = str(v.name);
    if (!name) fe.name = "費目名を入力してください";
    const reason = optStr(v.reason);
    if (!reason) fe.reason = "変更理由を入力してください";
    if (Object.keys(fe).length) throw new ValidationError(Object.values(fe), fe);
    const code = str(v.code);
    const managementFeeTarget = v.managementFeeTarget === true || v.managementFeeTarget === "on";
    const applyNow = calc.effectiveFrom <= todayJst();
    await adminDb().runTransaction(async (tx) => {
      const cur = await txGet<ItemTypeDoc>(tx, ctx, C.itemTypes, code);
      const vr = col(ctx.companyId, "itemTypeVersions").doc();
      const snapshot = { name: cur.name, tax: cur.tax, proration: cur.proration, managementFeeTarget: cur.managementFeeTarget, effectiveFrom: cur.effectiveFrom };
      const next = { name, ...calc, managementFeeTarget };
      tx.create(vr, {
        id: vr.id, companyId: ctx.companyId, code, docVersion: cur.version, snapshot, next,
        effectiveFrom: calc.effectiveFrom, status: applyNow ? "applied" : "scheduled",
        at: nowIso(), by: ctx.uid, byName: ctx.user.displayName, reason, archived: false,
      });
      const expected = v._version === null || v._version === undefined ? null : Number(v._version);
      if (applyNow) txUpdate(tx, ctx, C.itemTypes, cur, expected, { ...next, scheduledChange: null });
      else txUpdate(tx, ctx, C.itemTypes, cur, expected, { scheduledChange: { versionId: vr.id, effectiveFrom: calc.effectiveFrom } });
      audit(tx, ctx, applyNow ? "itemType.revise" : "itemType.schedule", C.itemTypes, code, { before: snapshot, after: next, reason });
    });
    return { redirect: "/settings?tab=items" };
  });
}
