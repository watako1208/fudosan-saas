"use server";
import type { Transaction } from "firebase-admin/firestore";
import { adminDb } from "../firebase-admin";
import { requireStaff, canAccessStore, Ctx } from "../session";
import { run, str, optStr, ActionResult } from "../action";
import {
  ValidationError, txGet, txCreate, txUpdate, audit, keywords, txNextNumber, runOnce, findDocs, listDocs, col, getMany, BaseDoc,
} from "../repo";
import { C, Party, PartyRole, PartyRoleKind, Property, Unit, Deal, Contract, Ownership } from "@/lib/types";
import type { PartyExt } from "@/lib/types-deals";
import type { ManagementFeeSetting } from "@/lib/domain/rules";
import type { Rounding } from "@/lib/domain/money";
import { isValidBizDate, todayJst, addDays } from "@/lib/domain/dates";
import { normPhone, normEmail, nameKey, aggregateRoles, validateOwnershipSet, parseShare } from "@/lib/domain/deals";

const ROLE_KINDS: PartyRoleKind[] = [
  "lessor", "lessee", "seller", "buyer", "prospect_tenant", "prospect_buyer", "owner", "tenant", "guarantor", "occupant", "vendor", "contact_person", "other",
];
const SUPPORT = ["none", "open", "in_progress", "done"] as const;
const ROLE_ENTITY_COL: Record<string, string> = { property: C.properties, unit: C.units, deal: C.deals, contract: C.contracts };

function ver(v: Record<string, unknown>): number | null {
  return v._version === null || v._version === undefined || v._version === "" ? null : Number(v._version);
}

function arr(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (typeof v === "string" && v) return [v];
  return [];
}

// ───────────── 役割の同期（Party.roles は partyRoles と手動設定の集約） ─────────────

async function txRoleRecords(tx: Transaction, ctx: Ctx, partyIds: string[]): Promise<PartyRole[]> {
  const out: PartyRole[] = [];
  const ids = [...new Set(partyIds.filter(Boolean))];
  for (let i = 0; i < ids.length; i += 30) {
    const snap = await tx.get(col(ctx.companyId, C.partyRoles).where("partyId", "in", ids.slice(i, i + 30)));
    snap.docs.forEach((d) => out.push({ ...(d.data() as PartyRole), id: d.id }));
  }
  return out;
}

function syncRoles(tx: Transaction, ctx: Ctx, party: PartyExt, records: PartyRole[], manualOverride?: PartyRoleKind[]) {
  const manual = manualOverride ?? party.manualRoles ?? [];
  const base = party.corporationId ? [...manual, "contact_person" as PartyRoleKind] : manual;
  const roles = aggregateRoles(base, records.filter((r) => r.partyId === party.id), todayJst());
  if (JSON.stringify(roles) !== JSON.stringify([...(party.roles ?? [])].sort())) {
    txUpdate(tx, ctx, C.parties, party, null, { roles });
  }
  return roles;
}

// ───────────── 顧客（S07） ─────────────

function partyFields(v: Record<string, unknown>) {
  const fe: Record<string, string> = {};
  const type = str(v.type) as Party["type"];
  if (!["person", "corporation"].includes(type)) fe.type = "個人・法人を選択してください";
  const name = str(v.name);
  if (!name) fe.name = type === "corporation" ? "法人名を入力してください" : "氏名を入力してください";
  const email = optStr(v.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fe.email = "メールアドレスの形式が正しくありません";
  const birthDate = optStr(v.birthDate);
  if (birthDate && !isValidBizDate(birthDate)) fe.birthDate = "日付が正しくありません";
  const supportStatus = (str(v.supportStatus) || "none") as Party["supportStatus"];
  if (!SUPPORT.includes(supportStatus)) fe.supportStatus = "対応状態が正しくありません";
  const manualRoles = arr(v.manualRoles).filter((r): r is PartyRoleKind => ROLE_KINDS.includes(r as PartyRoleKind));
  const corporationId = type === "person" ? optStr(v.corporationId) : null;
  const data = {
    type,
    name,
    kana: optStr(v.kana),
    corporationId,
    phone: optStr(v.phone),
    mobile: optStr(v.mobile),
    email,
    postalCode: optStr(v.postalCode),
    address: optStr(v.address),
    birthDate: type === "person" ? birthDate : null,
    assigneeUid: optStr(v.assigneeUid),
    storeId: optStr(v.storeId),
    preferences: optStr(v.preferences),
    memo: optStr(v.memo),
    supportStatus,
  };
  const dupKeys = {
    phoneNorms: [normPhone(data.phone), normPhone(data.mobile)].filter((x): x is string => !!x),
    emailNorm: normEmail(data.email),
    nameKey: nameKey(data.name, data.kana),
  };
  return { data, fe, manualRoles, dupKeys };
}

export interface DuplicateCandidate {
  id: string;
  number: string;
  name: string;
  kana: string | null;
  type: Party["type"];
  archived: boolean;
  reasons: string[];
}

async function findDuplicateCandidates(
  ctx: Ctx,
  k: { phoneNorms: string[]; emailNorm: string | null; nameKey: string | null },
  excludeId: string | null,
): Promise<DuplicateCandidate[]> {
  const hits = new Map<string, { p: PartyExt; reasons: Set<string> }>();
  const add = (list: PartyExt[], reason: string) => {
    for (const p of list) {
      if (p.id === excludeId) continue;
      const h = hits.get(p.id) ?? { p, reasons: new Set<string>() };
      h.reasons.add(reason);
      hits.set(p.id, h);
    }
  };
  if (k.phoneNorms.length) add(await findDocs<PartyExt>(ctx, C.parties, [["phoneNorms", "array-contains-any", k.phoneNorms.slice(0, 10)]], 20), "電話番号");
  if (k.emailNorm) add(await findDocs<PartyExt>(ctx, C.parties, [["emailNorm", "==", k.emailNorm]], 20), "メールアドレス");
  if (k.nameKey) add(await findDocs<PartyExt>(ctx, C.parties, [["nameKey", "==", k.nameKey]], 20), "氏名・読み");
  return [...hits.values()].map(({ p, reasons }) => ({
    id: p.id, number: p.number, name: p.name, kana: p.kana, type: p.type, archived: !!p.archived, reasons: [...reasons],
  }));
}

/** 入力中の内容で重複候補を確認する（自動統合はしない） */
export async function checkPartyDuplicates(v: Record<string, unknown>): Promise<ActionResult<DuplicateCandidate[]>> {
  return run(async () => {
    const ctx = await requireStaff("party.read");
    const { dupKeys } = partyFields(v);
    return findDuplicateCandidates(ctx, dupKeys, optStr(v.id));
  });
}

function duplicateError(c: DuplicateCandidate[]): ValidationError {
  return new ValidationError([
    `重複の可能性がある顧客が${c.length}件あります（自動統合はしません）`,
    ...c.map((x) => `${x.number} ${x.name}${x.kana ? `（${x.kana}）` : ""}: ${x.reasons.join("・")}が一致${x.archived ? "（アーカイブ済み）" : ""}`),
    "別人であれば「重複を確認して保存」を押してください。同一人物であれば既存の顧客に役割を追加してください。",
  ]);
}

export async function createParty(v: Record<string, unknown>): Promise<ActionResult<{ redirect: string }>> {
  return run(async () => {
    const ctx = await requireStaff("party.write");
    const { data, fe, manualRoles, dupKeys } = partyFields(v);
    if (Object.keys(fe).length) throw new ValidationError(Object.values(fe), fe);
    if (!canAccessStore(ctx, data.storeId)) throw new ValidationError(["この店舗に登録する権限がありません"], { storeId: "権限のない店舗です" });
    if (str(v._intent) !== "force") {
      const c = await findDuplicateCandidates(ctx, dupKeys, null);
      if (c.length) throw duplicateError(c);
    }
    const id = await runOnce(ctx, str(v._requestId), async (tx) => {
      if (data.corporationId) {
        const corp = await txGet<Party>(tx, ctx, C.parties, data.corporationId);
        if (corp.type !== "corporation") throw new ValidationError(["所属法人には法人を選択してください"], { corporationId: "法人を選択してください" });
      }
      const number = await txNextNumber(tx, ctx, "party", "C");
      const roles = aggregateRoles(data.corporationId ? [...manualRoles, "contact_person"] : manualRoles, [], todayJst());
      const id = txCreate(tx, ctx, C.parties, {
        ...data,
        ...dupKeys,
        number,
        roles,
        manualRoles,
        keywords: keywords(number, data.name, data.kana, data.phone, normPhone(data.phone), data.mobile, normPhone(data.mobile), data.email),
      } satisfies Omit<PartyExt, keyof BaseDoc>);
      audit(tx, ctx, "create", C.parties, id, { number, name: data.name, type: data.type, duplicateConfirmed: str(v._intent) === "force" });
      return id;
    });
    return { redirect: `/parties/${id}` };
  });
}

export async function updateParty(id: string, v: Record<string, unknown>): Promise<ActionResult<{ redirect: string }>> {
  return run(async () => {
    const ctx = await requireStaff("party.write");
    const { data, fe, manualRoles, dupKeys } = partyFields(v);
    if (Object.keys(fe).length) throw new ValidationError(Object.values(fe), fe);
    if (data.corporationId === id) throw new ValidationError(["所属法人に自分自身は指定できません"], { corporationId: "自分自身は指定できません" });
    if (str(v._intent) !== "force") {
      const c = await findDuplicateCandidates(ctx, dupKeys, id);
      if (c.length) throw duplicateError(c);
    }
    await adminDb().runTransaction(async (tx) => {
      const cur = await txGet<PartyExt>(tx, ctx, C.parties, id);
      if (!canAccessStore(ctx, cur.storeId) || !canAccessStore(ctx, data.storeId)) throw new ValidationError(["この店舗の顧客を編集する権限がありません"]);
      if (cur.type !== data.type && cur.type === "corporation") {
        const members = await tx.get(col(ctx.companyId, C.parties).where("corporationId", "==", id).limit(1));
        if (!members.empty) throw new ValidationError(["担当者が所属している法人は個人に変更できません"], { type: "所属する担当者がいます" });
      }
      if (data.corporationId) {
        const corp = await txGet<Party>(tx, ctx, C.parties, data.corporationId);
        if (corp.type !== "corporation") throw new ValidationError(["所属法人には法人を選択してください"], { corporationId: "法人を選択してください" });
      }
      if (cur.assigneeUid !== data.assigneeUid && !ctx.caps.has("assignee.change") && cur.assigneeUid && cur.assigneeUid !== ctx.uid) {
        throw new ValidationError(["担当者を変更する権限がありません"], { assigneeUid: "担当変更は店舗責任者以上が行えます" });
      }
      const records = await txRoleRecords(tx, ctx, [id]);
      const base = data.corporationId ? [...manualRoles, "contact_person" as PartyRoleKind] : manualRoles;
      const roles = aggregateRoles(base, records, todayJst());
      txUpdate(tx, ctx, C.parties, cur, ver(v), {
        ...data,
        ...dupKeys,
        manualRoles,
        roles,
        keywords: keywords(cur.number, data.name, data.kana, data.phone, normPhone(data.phone), data.mobile, normPhone(data.mobile), data.email),
      });
      audit(tx, ctx, "update", C.parties, id, { ...data, memo: data.memo ? "（社内メモ更新）" : null });
    });
    return { redirect: `/parties/${id}` };
  });
}

/** 取引履歴のある顧客は削除せずアーカイブ */
export async function archiveParty(input: Record<string, unknown>): Promise<ActionResult<{ redirect: string }>> {
  return run(async () => {
    const ctx = await requireStaff("party.write");
    const id = str(input.id);
    await adminDb().runTransaction(async (tx) => {
      const cur = await txGet<Party>(tx, ctx, C.parties, id);
      if (!canAccessStore(ctx, cur.storeId)) throw new ValidationError(["この店舗の顧客を編集する権限がありません"]);
      txUpdate(tx, ctx, C.parties, cur, null, { archived: !cur.archived });
      audit(tx, ctx, cur.archived ? "unarchive" : "archive", C.parties, id);
    });
    return { redirect: `/parties/${id}` };
  });
}

/** 顧客選択用の検索（名前・読み・電話・番号） */
export async function searchParties(input: { q: string; type?: string }): Promise<ActionResult<{ id: string; label: string; sub: string }[]>> {
  return run(async () => {
    const ctx = await requireStaff("party.read");
    const q = str(input.q);
    if (!q) return [];
    const where: [string, FirebaseFirestore.WhereFilterOp, unknown][] = [];
    if (input.type === "person" || input.type === "corporation") where.push(["type", "==", input.type]);
    const page = await listDocs<Party>(ctx, C.parties, { search: q, where, pageSize: 25 });
    return page.items.map((p) => ({
      id: p.id,
      label: `${p.name}${p.type === "corporation" ? "（法人）" : ""}`,
      sub: [p.number, p.kana, p.phone ?? p.mobile].filter(Boolean).join(" / "),
    }));
  });
}

// ───────────── 役割・関連（T02） ─────────────

/** 役割の関連先の検索（物件・部屋・案件・契約） */
export async function searchRoleTargets(input: { entity: string; q: string }): Promise<ActionResult<{ id: string; label: string; sub: string }[]>> {
  return run(async () => {
    const ctx = await requireStaff() // 関連先ごとの閲覧権限を下で確認;
    const q = str(input.q);
    if (!q) return [];
    if (input.entity === "property") {
      if (!ctx.caps.has("property.read")) throw new ValidationError(["物件を閲覧する権限がありません"]);
      const p = await listDocs<Property>(ctx, C.properties, { search: q, pageSize: 25 });
      return p.items.map((x) => ({ id: x.id, label: x.name, sub: [x.number, x.address].filter(Boolean).join(" / ") }));
    }
    if (input.entity === "unit") {
      if (!ctx.caps.has("property.read")) throw new ValidationError(["物件を閲覧する権限がありません"]);
      const p = await listDocs<Unit>(ctx, C.units, { search: q, pageSize: 25 });
      const props = await getMany<Property>(ctx, C.properties, p.items.map((u) => u.propertyId));
      return p.items.map((u) => ({ id: u.id, label: `${props.get(u.propertyId)?.name ?? "（物件不明）"} ${u.number}`, sub: props.get(u.propertyId)?.number ?? "" }));
    }
    if (input.entity === "deal") {
      if (!ctx.caps.has("deal.read")) throw new ValidationError(["案件を閲覧する権限がありません"]);
      const p = await listDocs<Deal>(ctx, C.deals, { search: q, pageSize: 25 });
      return p.items.map((x) => ({ id: x.id, label: x.title, sub: `${x.number} / ${x.kind === "sale" ? "売買" : "賃貸"}` }));
    }
    if (input.entity === "contract") {
      if (!ctx.caps.has("contract.read")) throw new ValidationError(["契約を閲覧する権限がありません"]);
      const p = await listDocs<Contract>(ctx, C.contracts, { search: q, pageSize: 25 });
      return p.items.map((x) => ({ id: x.id, label: x.title, sub: x.number }));
    }
    throw new ValidationError(["関連先の種類が正しくありません"]);
  });
}

/** 役割の追加。同じ顧客に複数の役割（例: 物件Xの貸主＋案件Yの購入希望者）を顧客を複製せずに持たせる */
export async function addPartyRole(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff("party.write");
    const fe: Record<string, string> = {};
    const partyId = str(input.partyId);
    const role = str(input.role) as PartyRoleKind;
    if (!ROLE_KINDS.includes(role)) fe.role = "役割を選択してください";
    const entity = str(input.entity) as PartyRole["entity"];
    if (!ROLE_ENTITY_COL[entity]) fe.entity = "関連先の種類を選択してください";
    const entityId = str(input.entityId);
    if (!entityId) fe.entityId = "関連先を選択してください";
    const from = optStr(input.from);
    const to = optStr(input.to);
    if (from && !isValidBizDate(from)) fe.from = "開始日が正しくありません";
    if (to && !isValidBizDate(to)) fe.to = "終了日が正しくありません";
    if (from && to && from > to) fe.to = "終了日が開始日より前です";
    if (Object.keys(fe).length) throw new ValidationError(Object.values(fe), fe);
    await runOnce(ctx, str(input._requestId), async (tx) => {
      const party = await txGet<PartyExt>(tx, ctx, C.parties, partyId);
      if (!canAccessStore(ctx, party.storeId)) throw new ValidationError(["この店舗の顧客を編集する権限がありません"]);
      const target = await txGet<BaseDoc & { storeId?: string | null }>(tx, ctx, ROLE_ENTITY_COL[entity], entityId);
      if (entity === "deal" && !canAccessStore(ctx, target.storeId)) throw new ValidationError(["この店舗の案件を編集する権限がありません"]);
      const records = await txRoleRecords(tx, ctx, [partyId]);
      if (records.some((r) => !r.archived && r.role === role && r.entity === entity && r.entityId === entityId && (!r.to || r.to >= todayJst()))) {
        throw new ValidationError(["同じ役割が既に登録されています"]);
      }
      const rec = { partyId, role, entity, entityId, from, to };
      const id = txCreate(tx, ctx, C.partyRoles, rec);
      syncRoles(tx, ctx, party, [...records, { ...rec, id, archived: false } as PartyRole]);
      audit(tx, ctx, "party_role.add", C.partyRoles, id, rec);
      return id;
    });
    return null;
  });
}

/** 役割の解除（記録はアーカイブとして残す） */
export async function removePartyRole(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff("party.write");
    await adminDb().runTransaction(async (tx) => {
      const rec = await txGet<PartyRole>(tx, ctx, C.partyRoles, str(input.id));
      const party = await txGet<PartyExt>(tx, ctx, C.parties, rec.partyId);
      if (!canAccessStore(ctx, party.storeId)) throw new ValidationError(["この店舗の顧客を編集する権限がありません"]);
      const records = await txRoleRecords(tx, ctx, [rec.partyId]);
      txUpdate(tx, ctx, C.partyRoles, rec, null, { archived: true });
      syncRoles(tx, ctx, party, records.map((r) => (r.id === rec.id ? { ...r, archived: true } : r)));
      audit(tx, ctx, "party_role.remove", C.partyRoles, rec.id, { role: rec.role, entity: rec.entity, entityId: rec.entityId });
    });
    return null;
  });
}

// ───────────── 所有者（/properties/[id]/owners） ─────────────

export interface OwnershipRowInput {
  id: string | null; // 既存レコード（null=追加）
  partyId: string;
  share: string;
  remitRatio: string | null;
  remainderReceiver: boolean;
  managementFee: ManagementFeeSetting | null;
  managedBy: string | null;
  removed?: boolean;
  alsoLessor?: boolean;
}

const ROUNDINGS: Rounding[] = ["floor", "round", "ceil"];
const DEC = /^\d+(\.\d+)?$/;

function cleanFee(f: ManagementFeeSetting | null, label: string, errs: string[]): ManagementFeeSetting | null {
  if (!f) return null;
  if (f.kind !== "fixed" && f.kind !== "rate") {
    errs.push(`${label}: 管理料の方式を選択してください`);
    return null;
  }
  const taxRate = str(f.taxRate) || "0.10";
  if (!DEC.test(taxRate) || Number(taxRate) > 1) errs.push(`${label}: 管理料の税率が正しくありません（例: 0.10）`);
  const rounding = ROUNDINGS.includes(f.rounding) ? f.rounding : "floor";
  const targetItemCodes = Array.isArray(f.targetItemCodes) ? f.targetItemCodes.map(String).filter(Boolean) : [];
  if (f.kind === "fixed") {
    const amt = Number(f.fixedAmount);
    if (f.fixedAmount === undefined || f.fixedAmount === null || !Number.isInteger(amt) || amt < 0) errs.push(`${label}: 管理料の定額は0以上の整数（円）で入力してください`);
    return { kind: "fixed", fixedAmount: amt, targetItemCodes, rounding, taxRate };
  }
  const rate = str(f.rate);
  if (!DEC.test(rate) || Number(rate) > 1) errs.push(`${label}: 管理料率が正しくありません（例: 5% は 0.05）`);
  if (targetItemCodes.length === 0) errs.push(`${label}: 管理料の対象費目を1つ以上選択してください`);
  return { kind: "rate", rate, targetItemCodes, rounding, taxRate };
}

/**
 * 所有者の一括保存。適用開始日を境に、変更・削除される既存レコードは終了日を設定して履歴を残し（上書きしない）、
 * 新しい条件・新しい所有者は新規レコードとして作成する。所有者・貸主の役割（partyRoles）も作成・終了する。
 */
export async function saveOwnerships(
  propertyId: string,
  input: { effectiveDate: string; rows: OwnershipRowInput[]; _requestId: string },
): Promise<ActionResult<{ redirect: string }>> {
  return run(async () => {
    const ctx = await requireStaff("property.write");
    const eff = str(input.effectiveDate);
    if (!isValidBizDate(eff)) throw new ValidationError(["適用開始日を入力してください"], { effectiveDate: "日付が正しくありません" });
    const prevDay = addDays(eff, -1);
    const errs: string[] = [];
    const rows = (input.rows ?? []).map((r, i) => {
      const label = `${i + 1}行目`;
      const share = str(r.share);
      const remitRatio = optStr(r.remitRatio);
      if (!r.removed && remitRatio && !parseShare(remitRatio)) errs.push(`${label}: 送金配分率が正しくありません`);
      return {
        id: r.id || null,
        partyId: str(r.partyId),
        share,
        remitRatio,
        remainderReceiver: !!r.remainderReceiver,
        managementFee: r.removed ? null : cleanFee(r.managementFee, label, errs),
        managedBy: optStr(r.managedBy),
        removed: !!r.removed,
        alsoLessor: r.alsoLessor !== false,
      };
    });
    rows.forEach((r, i) => !r.partyId && !r.removed && errs.push(`${i + 1}行目: 所有者を選択してください`));
    if (errs.length) throw new ValidationError(errs);

    await runOnce(ctx, str(input._requestId), async (tx) => {
      // ── 読込み ──
      const prop = await txGet<Property>(tx, ctx, C.properties, propertyId);
      if (!canAccessStore(ctx, prop.storeId)) throw new ValidationError(["この店舗の物件を編集する権限がありません"]);
      const ownSnap = await tx.get(col(ctx.companyId, C.ownerships).where("propertyId", "==", propertyId));
      const all = ownSnap.docs.map((d) => ({ ...(d.data() as Ownership), id: d.id }));
      const active = all.filter((o) => !o.archived && (!o.to || o.to >= eff));
      const partyIds = [...new Set([...rows.map((r) => r.partyId), ...active.map((o) => o.partyId)].filter(Boolean))];
      const parties = new Map<string, PartyExt>();
      for (const pid of partyIds) parties.set(pid, await txGet<PartyExt>(tx, ctx, C.parties, pid));
      const records = await txRoleRecords(tx, ctx, partyIds);

      // ── 計画 ──
      type Op =
        | { t: "end"; cur: Ownership }
        | { t: "archive"; cur: Ownership }
        | { t: "patch"; cur: Ownership; patch: Record<string, unknown> }
        | { t: "create"; data: Omit<Ownership, keyof BaseDoc> };
      const ops: Op[] = [];
      const resulting: { partyId: string; share: string; remitRatio: string | null; remainderReceiver: boolean }[] = [];
      const ending = new Set<string>(); // 役割を終了する partyId
      const starting = new Map<string, boolean>(); // partyId → 貸主も付与
      const touchedIds = new Set<string>();
      for (const r of rows) {
        const cur = r.id ? active.find((o) => o.id === r.id) : undefined;
        if (r.id && !cur) throw new ValidationError(["所有者情報が他の利用者により更新されています。画面を読み直してください"]);
        if (r.id) touchedIds.add(r.id);
        const fields = { share: r.share, remitRatio: r.remitRatio, remainderReceiver: r.remainderReceiver, managementFee: r.managementFee, managedBy: r.managedBy };
        if (cur && r.removed) {
          ops.push(cur.from >= eff ? { t: "archive", cur } : { t: "end", cur });
          ending.add(cur.partyId);
          continue;
        }
        if (r.removed) continue;
        if (cur) {
          if (cur.partyId !== r.partyId) throw new ValidationError(["既存の所有者は変更できません。所有者を変更する場合は削除して新しい所有者を追加してください"]);
          const same =
            cur.share === fields.share && (cur.remitRatio ?? null) === fields.remitRatio && !!cur.remainderReceiver === fields.remainderReceiver &&
            JSON.stringify(cur.managementFee ?? null) === JSON.stringify(fields.managementFee) && (cur.managedBy ?? null) === fields.managedBy;
          if (!same) {
            if (cur.from >= eff) ops.push({ t: "patch", cur, patch: fields });
            else {
              ops.push({ t: "end", cur });
              ops.push({ t: "create", data: { propertyId, partyId: r.partyId, from: eff, to: null, ...fields } });
            }
          }
        } else {
          ops.push({ t: "create", data: { propertyId, partyId: r.partyId, from: eff, to: null, ...fields } });
          starting.set(r.partyId, r.alsoLessor);
        }
        resulting.push({ partyId: r.partyId, ...fields });
      }
      // 画面に含まれなかった既存の有効レコードはそのまま有効
      for (const o of active) {
        if (!touchedIds.has(o.id)) resulting.push({ partyId: o.partyId, share: o.share, remitRatio: o.remitRatio ?? null, remainderReceiver: !!o.remainderReceiver });
      }
      if (resulting.length === 1 && !resulting[0].remainderReceiver) {
        // 単独所有なら端数の配分先は本人
        const only = resulting[0];
        only.remainderReceiver = true;
        for (const op of ops) {
          if (op.t === "create" && op.data.partyId === only.partyId) op.data.remainderReceiver = true;
          if (op.t === "patch" && op.cur.partyId === only.partyId) op.patch.remainderReceiver = true;
        }
      }
      const verr = validateOwnershipSet(resulting.map((r) => ({ ...r, partyName: parties.get(r.partyId)?.name })));
      if (verr.length) throw new ValidationError(verr);

      // ── 書込み ──
      const newRecords = [...records];
      for (const op of ops) {
        if (op.t === "end") txUpdate(tx, ctx, C.ownerships, op.cur, null, { to: prevDay < op.cur.from ? op.cur.from : prevDay });
        if (op.t === "archive") txUpdate(tx, ctx, C.ownerships, op.cur, null, { archived: true });
        if (op.t === "patch") txUpdate(tx, ctx, C.ownerships, op.cur, null, op.patch);
        if (op.t === "create") txCreate(tx, ctx, C.ownerships, op.data);
      }
      const stillOwner = new Set(resulting.map((r) => r.partyId));
      for (const pid of ending) {
        if (stillOwner.has(pid)) continue;
        for (const rec of records) {
          if (rec.partyId === pid && !rec.archived && rec.entity === "property" && rec.entityId === propertyId && ["owner", "lessor"].includes(rec.role) && !rec.to) {
            txUpdate(tx, ctx, C.partyRoles, rec, null, { to: prevDay });
            const i = newRecords.findIndex((x) => x.id === rec.id);
            newRecords[i] = { ...rec, to: prevDay };
          }
        }
      }
      for (const [pid, alsoLessor] of starting) {
        const want: PartyRoleKind[] = alsoLessor ? ["owner", "lessor"] : ["owner"];
        for (const role of want) {
          const exists = newRecords.some((x) => x.partyId === pid && !x.archived && x.role === role && x.entity === "property" && x.entityId === propertyId && (!x.to || x.to >= eff));
          if (exists) continue;
          const rec = { partyId: pid, role, entity: "property" as const, entityId: propertyId, from: eff, to: null };
          const rid = txCreate(tx, ctx, C.partyRoles, rec);
          newRecords.push({ ...rec, id: rid, archived: false } as PartyRole);
        }
      }
      for (const pid of new Set([...ending, ...starting.keys()])) {
        const p = parties.get(pid);
        if (p) syncRoles(tx, ctx, p, newRecords);
      }
      audit(tx, ctx, "ownership.save", C.properties, propertyId, { effectiveDate: eff, ops: ops.map((o) => o.t), owners: resulting });
      return null;
    });
    return { redirect: `/properties/${propertyId}?tab=basic` };
  });
}
