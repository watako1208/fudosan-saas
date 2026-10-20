"use server";
import { FieldValue, Transaction } from "firebase-admin/firestore";
import { adminDb } from "../firebase-admin";
import { requireStaff, canAccessStore, Ctx } from "../session";
import { run, str, optStr, optYen, ActionResult } from "../action";
import {
  ValidationError, NotFoundError, txGet, txCreate, txUpdate, audit, keywords, txNextNumber, runOnce, mustGet, getMany, findDocs,
  listDocs, col, ref, nowIso, BaseDoc,
} from "../repo";
import { itemTypes, companySettings } from "../lookups";
import { notify } from "../notify";
import {
  C, Contract, ContractVersion, ContractPartySnapshot, DeadlineRule, Deal, Unit, Property, Listing, Ownership, Party, PartyRole,
  PartyRoleKind, ApprovalRecord, Attachment, TaskDoc, ItemTypeDoc, DepositEntryDoc,
} from "@/lib/types";
import { DEFAULT_ITEM_TYPES } from "@/lib/defaults";
import { isValidBizDate, todayJst, compare, addDays } from "@/lib/domain/dates";
import type { TaxSetting, ProrationSetting, Rounding } from "@/lib/domain/money";
import { findOverlappingContracts, MonthlyItem, OccupancyContract } from "@/lib/domain/rules";
import { leaseConfirmErrors, saleConfirmErrors, validateChangeEffectiveFrom, previousEffectiveTo } from "@/lib/domain/contracts";

type Snap = ContractPartySnapshot;
type Role = Snap["role"];
const LEASE_ROLES: Role[] = ["lessor", "lessee", "guarantor", "occupant"];
const SALE_ROLES: Role[] = ["seller", "buyer", "agent"];
const ROUNDINGS: Rounding[] = ["floor", "round", "ceil"];

// ───────────── 入力の読取り ─────────────

function json<T>(raw: unknown, fe: Record<string, string>, field: string, label: string): T[] {
  if (raw === undefined || raw === null || raw === "") return [];
  try {
    const v = JSON.parse(String(raw));
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    fe[field] = `${label}の入力内容を読み取れません`;
    return [];
  }
}

function optDate(v: unknown, field: string, fe: Record<string, string>): string | null {
  const s = optStr(v);
  if (s && !isValidBizDate(s)) {
    fe[field] = "日付が正しくありません";
    return null;
  }
  return s;
}

function optInt(v: unknown, field: string, fe: Record<string, string>, min = 0, max = 10000): number | null {
  const s = str(v).normalize("NFKC");
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isInteger(n) || n < min || n > max) {
    fe[field] = `${min}〜${max}の整数で入力してください`;
    return null;
  }
  return n;
}

function yenOf(v: unknown): number | null {
  if (v === null || v === undefined || str(v) === "") return null;
  const n = Number(str(v).normalize("NFKC").replace(/[,¥円]/g, ""));
  return Number.isInteger(n) ? n : NaN;
}

function parseTax(t: Partial<TaxSetting> | undefined, where: string, errs: string[]): TaxSetting {
  const category = (["taxable", "exempt", "non_taxable"] as const).includes(t?.category as never) ? t!.category! : "taxable";
  const rate = category === "taxable" ? str(t?.rate) || "0.10" : "0";
  if (!/^0(\.\d{1,4})?$/.test(rate)) errs.push(`${where}: 税率は 0.10 のように小数で入力してください`);
  return { category, rate, priceMode: t?.priceMode === "inclusive" ? "inclusive" : "exclusive" };
}

function parseProration(p: Partial<ProrationSetting> | undefined): ProrationSetting {
  const method = (["actual", "fixed30", "none"] as const).includes(p?.method as never) ? p!.method! : "actual";
  const rounding = ROUNDINGS.includes(p?.rounding as Rounding) ? (p!.rounding as Rounding) : "floor";
  const out: ProrationSetting = { method, rounding };
  if (method === "fixed30") out.fixed30Counting = p?.fixed30Counting === "month_end_as_30" ? "month_end_as_30" : "calendar_cap30";
  return out;
}

function parseMonthly(raw: unknown, fe: Record<string, string>): MonthlyItem[] {
  const errs: string[] = [];
  const rows = json<Partial<MonthlyItem> & { amount: unknown }>(raw, fe, "monthlyItems", "月額費用").map((r, i) => {
    const amount = yenOf(r.amount);
    if (Number.isNaN(amount)) errs.push(`月額費用 ${i + 1}行目: 金額は円単位の整数で入力してください`);
    if (!str(r.code)) errs.push(`月額費用 ${i + 1}行目: 費目を選択してください`);
    return {
      code: str(r.code),
      name: str(r.name) || str(r.code),
      amount: Number.isNaN(amount) ? null : amount, // 下書きでは未入力（null）を許容
      tax: parseTax(r.tax, `月額費用 ${i + 1}行目`, errs),
      proration: parseProration(r.proration),
    } as unknown as MonthlyItem;
  });
  const codes = rows.map((r) => r.code).filter(Boolean);
  if (new Set(codes).size !== codes.length) errs.push("月額費用に同じ費目が重複しています（同じ費目は1行にまとめてください）");
  if (errs.length) fe.monthlyItems = errs.join(" / ");
  return rows;
}

type InitialItem = ContractVersion["initialItems"][number];
function parseInitial(raw: unknown, fe: Record<string, string>): InitialItem[] {
  const errs: string[] = [];
  const rows = json<Partial<InitialItem> & { amount: unknown }>(raw, fe, "initialItems", "初期費用").map((r, i) => {
    const amount = yenOf(r.amount);
    if (Number.isNaN(amount)) errs.push(`初期費用 ${i + 1}行目: 金額は円単位の整数で入力してください`);
    if (!str(r.code)) errs.push(`初期費用 ${i + 1}行目: 費目を選択してください`);
    return {
      code: str(r.code),
      name: str(r.name) || str(r.code),
      amount: Number.isNaN(amount) ? null : amount,
      tax: parseTax(r.tax, `初期費用 ${i + 1}行目`, errs),
    } as unknown as InitialItem;
  });
  if (errs.length) fe.initialItems = errs.join(" / ");
  return rows;
}

function parseRule(v: Record<string, unknown>, prefix: string, fe: Record<string, string>): DeadlineRule | null {
  const amount = optInt(v[`${prefix}Amount`], `${prefix}Amount`, fe, 0, 365);
  if (amount === null) return null;
  return {
    base: "contract_end",
    unit: str(v[`${prefix}Unit`]) === "days" ? "days" : "months",
    amount,
    holidayAdjust: str(v[`${prefix}Holiday`]) === "previous_weekday" ? "previous_weekday" : "none",
  };
}

function parseBrokerage(v: Record<string, unknown>, fe: Record<string, string>): ContractVersion["brokerageFee"] {
  const method = str(v.brokerageMethod);
  if (method !== "rate" && method !== "fixed") return null;
  const rate = optStr(v.brokerageRate);
  if (rate && !/^\d+(\.\d{1,6})?$/.test(rate)) fe.brokerageRate = "料率は 0.03 や 1.0 のように小数で入力してください";
  const errs: string[] = [];
  const tax = parseTax({ category: str(v.brokerageTaxCategory) as TaxSetting["category"], rate: str(v.brokerageTaxRate), priceMode: str(v.brokeragePriceMode) as TaxSetting["priceMode"] }, "仲介手数料", errs);
  if (errs.length) fe.brokerageTaxRate = errs.join(" / ");
  return {
    method,
    rate: method === "rate" ? rate : null,
    fixed: method === "fixed" ? optYen(v.brokerageFixed, "brokerageFixed", fe) : null,
    plus: optYen(v.brokeragePlus, "brokeragePlus", fe),
    tax,
    billTo: optStr(v.brokerageBillTo),
  };
}

interface PartyRef {
  partyId: string;
  role: Role;
  share: string | null;
}

function parsePartyRefs(raw: unknown, kind: Contract["kind"], fe: Record<string, string>): PartyRef[] {
  const allowed = kind === "sale" ? SALE_ROLES : LEASE_ROLES;
  const seen = new Set<string>();
  const out: PartyRef[] = [];
  for (const r of json<Partial<PartyRef>>(raw, fe, "parties", "当事者")) {
    const partyId = str(r.partyId);
    const role = str(r.role) as Role;
    if (!partyId || partyId.includes("/")) continue;
    if (!allowed.includes(role)) {
      fe.parties = "当事者の役割が正しくありません";
      continue;
    }
    const k = `${partyId}:${role}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const share = optStr(r.share);
    if (share && !/^(\d+\/\d+|0?\.\d+|1(\.0+)?)$/.test(share)) fe.parties = "持分は 1/2 や 0.5 の形式で入力してください";
    out.push({ partyId, role, share });
  }
  return out;
}

function snapshotOf(p: Party, role: Role, share: string | null): Snap {
  return { partyId: p.id, role, type: p.type, name: p.name, kana: p.kana ?? null, address: p.address ?? null, phone: p.phone ?? p.mobile ?? null, share };
}

function approval(ctx: Ctx, action: ApprovalRecord["action"], reason: string | null, versionId: string | null): ApprovalRecord {
  return { action, by: ctx.uid, byName: ctx.user.displayName, at: nowIso(), reason, versionId };
}

function contractKeywords(number: string, title: string, parties: Snap[], extra: (string | null | undefined)[] = []) {
  return keywords(number, title, ...parties.map((p) => p.name), ...parties.map((p) => p.kana), ...extra);
}

function expected(v: unknown): number | null {
  return v === null || v === undefined || v === "" ? null : Number(v);
}

/** B03: 確定時の検証（契約と版から） */
function confirmErrorsOf(c: Pick<Contract, "kind" | "unitId" | "propertyIds" | "depositHolder">, ver: ContractVersion): string[] {
  if (c.kind === "sale") {
    return saleConfirmErrors({
      parties: ver.parties, propertyIds: c.propertyIds, salePrice: ver.salePrice, earnestMoney: ver.earnestMoney, balanceAmount: ver.balanceAmount,
      contractDate: ver.contractDate, settlementDate: ver.settlementDate, deliveryDate: ver.deliveryDate, documentsChecked: ver.documentsChecked,
    });
  }
  return leaseConfirmErrors({
    parties: ver.parties, unitId: c.unitId, leaseType: ver.leaseType, start: ver.start, end: ver.end,
    monthlyItems: ver.monthlyItems, documentsChecked: ver.documentsChecked, depositAmount: ver.depositAmount, depositHolder: c.depositHolder,
  });
}

function itemTypeLookup(types: ItemTypeDoc[]) {
  return (code: string) => {
    const t = types.find((x) => x.code === code) ?? DEFAULT_ITEM_TYPES.find((x) => x.code === code);
    return t ?? null;
  };
}

// ───────────── 検索（当事者・区画・物件の選択用） ─────────────

export async function searchParties(input: { q: string }): Promise<ActionResult<{ id: string; label: string; sub: string }[]>> {
  return run(async () => {
    const ctx = await requireStaff("contract.write");
    if (!str(input.q)) return [];
    const page = await listDocs<Party>(ctx, C.parties, { search: str(input.q), pageSize: 25, orderBy: "updatedAt" });
    return page.items.map((p) => ({ id: p.id, label: `${p.name}${p.type === "corporation" ? "（法人）" : ""}`, sub: [p.number, p.kana, p.address].filter(Boolean).join(" / ") }));
  });
}

export async function searchUnits(input: { q: string }): Promise<ActionResult<{ id: string; label: string; sub: string }[]>> {
  return run(async () => {
    const ctx = await requireStaff("contract.write");
    if (!str(input.q)) return [];
    const page = await listDocs<Unit>(ctx, C.units, { search: str(input.q), pageSize: 25, orderBy: "updatedAt" });
    const props = await getMany<Property>(ctx, C.properties, page.items.map((u) => u.propertyId));
    return page.items.map((u) => {
      const p = props.get(u.propertyId);
      return { id: u.id, label: `${p?.name ?? "（物件不明）"} ${u.number}`, sub: [p?.number, p?.address, u.layout].filter(Boolean).join(" / ") };
    });
  });
}

export async function searchProperties(input: { q: string }): Promise<ActionResult<{ id: string; label: string; sub: string }[]>> {
  return run(async () => {
    const ctx = await requireStaff("contract.write");
    if (!str(input.q)) return [];
    const page = await listDocs<Property>(ctx, C.properties, { search: str(input.q), pageSize: 25, orderBy: "updatedAt" });
    return page.items.map((p) => ({ id: p.id, label: p.name, sub: [p.number, p.address].filter(Boolean).join(" / ") }));
  });
}

// ───────────── 新規作成（T01: 物件・案件からの引継ぎ） ─────────────

function emptyVersion(contractId: string, effectiveFrom: string, rounding: Rounding): Omit<ContractVersion, keyof BaseDoc> {
  return {
    contractId, versionNo: 1, effectiveFrom, effectiveTo: null, status: "draft", confirmedBy: null, confirmedAt: null, parties: [],
    leaseType: null, start: null, end: null, monthlyItems: [], initialItems: [], depositAmount: null, paymentDueDay: null,
    paymentTiming: "prev_month", renewal: { termMonths: null, fee: null, noticeRule: null }, termination: { noticeRule: null },
    salePrice: null, earnestMoney: null, balanceAmount: null, contractDate: null, settlementDate: null, deliveryDate: null, loan: null,
    brokerageFee: null, specialTerms: null, documentsChecked: false, changeReason: null, rounding,
  };
}

export async function createContract(v: Record<string, unknown>): Promise<ActionResult<{ redirect: string }>> {
  return run(async () => {
    const ctx = await requireStaff("contract.write");
    const kind = str(v.kind) === "sale" ? "sale" : str(v.kind) === "lease" ? "lease" : null;
    if (!kind) throw new ValidationError(["契約の種類（賃貸・売買）を選択してください"], { kind: "選択してください" });
    const dealId = optStr(v.dealId);
    let unitId = optStr(v.unitId);
    const today = todayJst();

    const deal = dealId ? await mustGet<Deal>(ctx, C.deals, dealId) : null;
    if (deal && !unitId && kind === "lease") unitId = deal.unitIds?.[0] ?? null;
    const unit = unitId ? await mustGet<Unit>(ctx, C.units, unitId) : null;
    let propertyIds: string[] = [];
    if (kind === "lease") propertyIds = unit ? [unit.propertyId] : [];
    else {
      const pidsIn = json<string>(v.propertyIds, {}, "propertyIds", "対象物件").map(str).filter((x) => x && !x.includes("/"));
      const pid = optStr(v.propertyId);
      propertyIds = pidsIn.length ? pidsIn : pid ? [pid] : deal?.propertyIds?.length ? deal.propertyIds : unit ? [unit.propertyId] : [];
    }
    const props = await getMany<Property>(ctx, C.properties, propertyIds);
    propertyIds = propertyIds.filter((id) => props.has(id));
    const firstProp = props.get(propertyIds[0]) ?? null;

    const lookup = itemTypeLookup(await itemTypes(ctx.companyId));
    const settings = await companySettings(ctx.companyId);
    const rounding: Rounding = ROUNDINGS.includes(settings.lineRounding) ? settings.lineRounding : "floor";

    // 現在の募集条件（後の版で置き換えられていないもの）。条件の値は版へコピーし、以後の募集条件変更の影響を受けない
    const pickListing = (ls: Listing[], dealType: "rent" | "sale") => {
      const cur = ls.filter((l) => !l.supersededBy && !l.archived && l.dealType === dealType);
      const effective = cur.filter((l) => compare(l.effectiveFrom, today) <= 0).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
      return effective[0] ?? cur.sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1))[0] ?? null;
    };
    let listing: Listing | null = null;
    if (kind === "lease" && unit) listing = pickListing(await findDocs<Listing>(ctx, C.listings, [["unitId", "==", unit.id]]), "rent");
    if (kind === "sale" && firstProp) {
      listing = pickListing((await findDocs<Listing>(ctx, C.listings, [["propertyId", "==", firstProp.id]])).filter((l) => !l.unitId || l.unitId === unitId), "sale");
    }

    // 当事者: 物件の現在の所有者（貸主・売主）と案件の顧客（借主・買主）
    const refs: PartyRef[] = [];
    for (const pid of propertyIds) {
      const owns = await findDocs<Ownership>(ctx, C.ownerships, [["propertyId", "==", pid]]);
      for (const o of owns.filter((o) => !o.archived && compare(o.from, today) <= 0 && (!o.to || compare(today, o.to) <= 0))) {
        const role: Role = kind === "sale" ? "seller" : "lessor";
        if (!refs.some((r) => r.partyId === o.partyId && r.role === role)) refs.push({ partyId: o.partyId, role, share: o.share ?? null });
      }
    }
    if (deal?.customerId) {
      const role: Role = kind === "lease" ? "lessee" : deal.side === "seller" ? "seller" : "buyer";
      if (!refs.some((r) => r.partyId === deal.customerId && r.role === role)) refs.push({ partyId: deal.customerId, role, share: null });
    }
    const partyDocs = await getMany<Party>(ctx, C.parties, refs.map((r) => r.partyId));
    const parties = refs.filter((r) => partyDocs.has(r.partyId)).map((r) => snapshotOf(partyDocs.get(r.partyId)!, r.role, r.share));

    const monthlyItems: MonthlyItem[] = [];
    const initialItems: InitialItem[] = [];
    let depositAmount: number | null = null;
    if (kind === "lease" && listing) {
      const rentCode = unit?.usage === "parking" ? "parking" : unit && ["store", "office"].includes(unit.usage) ? "rent_commercial" : "rent";
      const add = (code: string, amount: number | null) => {
        const t = lookup(code);
        if (amount === null || !t) return;
        monthlyItems.push({ code, name: t.name, amount, tax: t.tax, proration: t.proration });
      };
      add(rentCode, listing.rent);
      add("common_fee", listing.commonFee);
      if (listing.keyMoney !== null) {
        const t = lookup("key_money");
        if (t) initialItems.push({ code: "key_money", name: t.name, amount: listing.keyMoney, tax: t.tax });
      }
      depositAmount = listing.deposit;
    }

    const storeId = unit?.storeId ?? firstProp?.storeId ?? deal?.storeId ?? null;
    if (!canAccessStore(ctx, storeId)) throw new ValidationError(["この店舗の契約を作成する権限がありません"]);
    const title =
      kind === "lease"
        ? `${firstProp?.name ?? ""}${unit ? ` ${unit.number}` : ""} 賃貸借契約`.trim()
        : `${propertyIds.map((id) => props.get(id)!.name).join("・")} 売買契約`.trim();

    const id = await runOnce(ctx, str(v._requestId), async (tx) => {
      const dealCur = deal ? await txGet<Deal>(tx, ctx, C.deals, deal.id) : null;
      const number = await txNextNumber(tx, ctx, "contract", "K");
      const cid = col(ctx.companyId, C.contracts).doc().id;
      const vid = col(ctx.companyId, C.contractVersions).doc().id;
      txCreate(
        tx, ctx, C.contracts,
        {
          number, kind, status: "draft", title, unitId: kind === "lease" ? unit?.id ?? null : null, propertyIds, dealId: deal?.id ?? null, storeId,
          assigneeUid: deal?.assigneeUid ?? ctx.uid, currentVersionId: vid, start: null, end: null, executedAt: null, executedBy: null,
          executedDocAttachmentId: null, depositHolder: null, overlapException: null, approvals: [], partyIds: [...new Set(parties.map((p) => p.partyId))],
          keywords: contractKeywords(number, title, parties, [firstProp?.address]),
        } satisfies Omit<Contract, keyof BaseDoc>,
        cid,
      );
      txCreate(
        tx, ctx, C.contractVersions,
        {
          ...emptyVersion(cid, today, rounding),
          parties,
          monthlyItems,
          initialItems,
          depositAmount,
          salePrice: kind === "sale" ? listing?.price ?? null : null,
        } satisfies Omit<ContractVersion, keyof BaseDoc>,
        vid,
      );
      if (dealCur) txUpdate(tx, ctx, C.deals, dealCur, null, { contractId: cid });
      audit(tx, ctx, "create", C.contracts, cid, { number, kind, dealId: deal?.id ?? null, unitId, listingId: listing?.id ?? null, prefilledParties: parties.length });
      return cid;
    });
    return { redirect: `/contracts/${id}/edit` };
  });
}

// ───────────── 編集（下書き保存・提出・条件変更の確定） ─────────────

export async function saveContractVersion(contractId: string, versionId: string, v: Record<string, unknown>): Promise<ActionResult<{ redirect: string }>> {
  return run(async () => {
    const ctx = await requireStaff("contract.write");
    const intent = str(v._intent) || "draft";
    const c0 = await mustGet<Contract>(ctx, C.contracts, contractId);
    const fe: Record<string, string> = {};
    const isSale = c0.kind === "sale";

    const partyRefs = parsePartyRefs(v.parties, c0.kind, fe);
    const title = str(v.title);
    if (!title) fe.title = "件名を入力してください";
    const common = {
      specialTerms: optStr(v.specialTerms),
      documentsChecked: v.documentsChecked === true || v.documentsChecked === "true" || v.documentsChecked === "on",
      brokerageFee: parseBrokerage(v, fe),
      changeReason: optStr(v.changeReason),
      rounding: (ROUNDINGS.includes(str(v.rounding) as Rounding) ? str(v.rounding) : "floor") as Rounding,
    };
    let lease: Partial<ContractVersion> = {};
    let sale: Partial<ContractVersion> = {};
    let unitIdIn: string | null = null;
    let propertyIdsIn: string[] = [];
    let depositHolder: Contract["depositHolder"] = null;
    if (!isSale) {
      unitIdIn = optStr(v.unitId);
      const start = optDate(v.start, "start", fe);
      const end = optDate(v.end, "end", fe);
      if (start && end && compare(start, end) > 0) fe.end = "契約終了日が開始日より前です";
      const lt = str(v.leaseType);
      depositHolder = (["company", "lessor", "other"].includes(str(v.depositHolder)) ? str(v.depositHolder) : null) as Contract["depositHolder"];
      lease = {
        leaseType: lt === "ordinary" || lt === "fixed_term" ? lt : null,
        start,
        end,
        monthlyItems: parseMonthly(v.monthlyItems, fe),
        initialItems: parseInitial(v.initialItems, fe),
        depositAmount: optYen(v.depositAmount, "depositAmount", fe),
        paymentDueDay: optInt(v.paymentDueDay, "paymentDueDay", fe, 1, 31),
        paymentTiming: str(v.paymentTiming) === "current_month" ? "current_month" : "prev_month",
        renewal: {
          termMonths: optInt(v.renewalTermMonths, "renewalTermMonths", fe, 1, 600),
          fee: optYen(v.renewalFee, "renewalFee", fe),
          noticeRule: parseRule(v, "renewalNotice", fe),
        },
        termination: { noticeRule: parseRule(v, "terminationNotice", fe) },
      };
    } else {
      propertyIdsIn = [...new Set(json<string>(v.propertyIds, fe, "propertyIds", "対象物件").map(str).filter((x) => x && !x.includes("/")))];
      const contractDate = optDate(v.contractDate, "contractDate", fe);
      const settlementDate = optDate(v.settlementDate, "settlementDate", fe);
      const deliveryDate = optDate(v.deliveryDate, "deliveryDate", fe);
      const loanAmount = optYen(v.loanAmount, "loanAmount", fe);
      const loanDeadline = optDate(v.loanDeadline, "loanDeadline", fe);
      const loanLender = optStr(v.loanLender);
      const loanContingent = v.loanContingent === true || v.loanContingent === "true" || v.loanContingent === "on";
      sale = {
        salePrice: optYen(v.salePrice, "salePrice", fe),
        earnestMoney: optYen(v.earnestMoney, "earnestMoney", fe),
        balanceAmount: optYen(v.balanceAmount, "balanceAmount", fe),
        contractDate,
        settlementDate,
        deliveryDate,
        start: contractDate,
        end: deliveryDate,
        loan: loanAmount !== null || loanDeadline || loanLender || loanContingent ? { amount: loanAmount, deadline: loanDeadline, lender: loanLender, contingent: loanContingent } : null,
      };
    }
    const effectiveFromIn = optDate(v.effectiveFrom, "effectiveFrom", fe);
    if (Object.keys(fe).length) throw new ValidationError(Object.values(fe), fe);
    const assigneeUid = optStr(v.assigneeUid);

    let redirect = `/contracts/${contractId}`;
    await adminDb().runTransaction(async (tx) => {
      // ── 読込み ──
      const c = await txGet<Contract>(tx, ctx, C.contracts, contractId);
      const ver = await txGet<ContractVersion>(tx, ctx, C.contractVersions, versionId);
      if (ver.contractId !== c.id || ver.archived) throw new NotFoundError();
      if (ver.status === "confirmed") throw new ValidationError(["確定済みの版は変更できません。条件を変更する場合は「条件変更（新しい版）」を作成してください"]);
      if (!canAccessStore(ctx, c.storeId)) throw new ValidationError(["この店舗の契約を編集する権限がありません"]);
      const isInitial = c.currentVersionId === ver.id;
      if (isInitial && c.status !== "draft") throw new ValidationError([`「${c.status === "in_review" ? "社内確認中" : "下書き以外"}」の契約は編集できません。差戻し後に編集してください`]);
      if (!isInitial && !["executed", "active"].includes(c.status)) throw new ValidationError(["条件変更は締結記録済み・契約期間中の契約でのみ行えます"]);
      if (c.assigneeUid !== assigneeUid && c.assigneeUid && c.assigneeUid !== ctx.uid && !ctx.caps.has("assignee.change")) {
        throw new ValidationError(["担当者を変更する権限がありません"], { assigneeUid: "担当変更は店舗責任者以上が行えます" });
      }
      const pdocs = await Promise.all([...new Set(partyRefs.map((p) => p.partyId))].map((id) => txGet<Party>(tx, ctx, C.parties, id)));
      const pmap = new Map(pdocs.map((p) => [p.id, p]));
      const unitId = isSale ? null : isInitial ? unitIdIn : c.unitId;
      const unit = unitId ? await txGet<Unit>(tx, ctx, C.units, unitId) : null;
      const propertyIds = isSale ? propertyIdsIn : unit ? [unit.propertyId] : [];
      const props = await Promise.all(propertyIds.map((id) => txGet<Property>(tx, ctx, C.properties, id)));
      const curVer = !isInitial && c.currentVersionId ? await txGet<ContractVersion>(tx, ctx, C.contractVersions, c.currentVersionId) : null;
      const taskSnaps = isSale ? await Promise.all(SALE_TASKS.map((t) => tx.get(ref(ctx, C.tasks, `${c.id}__${t.key}`)))) : [];

      // ── 検証 ──
      const parties = partyRefs.map((r) => snapshotOf(pmap.get(r.partyId)!, r.role, r.share)); // 保存時点の台帳内容を固定
      const effectiveFrom = isInitial ? (isSale ? sale.contractDate : lease.start) ?? ver.effectiveFrom : effectiveFromIn ?? ver.effectiveFrom;
      const next: ContractVersion = { ...ver, ...common, ...(isSale ? sale : lease), parties, effectiveFrom };
      const nextContract = { kind: c.kind, unitId, propertyIds, depositHolder: isSale ? c.depositHolder : depositHolder };
      if (!isInitial && curVer) {
        const e = validateChangeEffectiveFrom(curVer.effectiveFrom, effectiveFromIn, isSale ? null : lease.end ?? null);
        if (e.length) throw new ValidationError(e, { effectiveFrom: e[0] });
      }
      if (intent === "submit" || intent === "confirm") {
        const e = confirmErrorsOf(nextContract, next);
        if (!isInitial && !common.changeReason) e.push("変更理由を入力してください");
        if (e.length) throw new ValidationError(e);
      }
      if (intent === "confirm" && (!ctx.caps.has("contract.approve") || isInitial)) throw new ValidationError(["条件変更を確定する権限がありません（契約承認権限が必要です）"]);

      // ── 書込み ──
      const versionPatch = { ...common, ...(isSale ? sale : lease), parties, effectiveFrom };
      const contractPatch: Record<string, unknown> = {
        title,
        assigneeUid,
        keywords: contractKeywords(c.number, title, parties, props.map((p) => p.name).concat(props.map((p) => p.address ?? ""))),
      };
      if (isInitial) {
        Object.assign(contractPatch, {
          unitId,
          propertyIds,
          storeId: unit?.storeId ?? props[0]?.storeId ?? c.storeId,
          start: next.start,
          end: next.end,
          partyIds: [...new Set(parties.map((p) => p.partyId))],
        });
      }
      if (!isSale) contractPatch.depositHolder = depositHolder;

      if (intent === "confirm" && curVer) {
        // B05: 新しい版を確定し、前の版の適用期間を閉じる。確定済み請求・発行済み書類は変更しない
        txUpdate(tx, ctx, C.contractVersions, curVer, null, { effectiveTo: previousEffectiveTo(effectiveFrom) });
        txUpdate(tx, ctx, C.contractVersions, ver, expected(v._version), { ...versionPatch, status: "confirmed", confirmedBy: ctx.uid, confirmedAt: nowIso(), effectiveTo: null });
        Object.assign(contractPatch, {
          currentVersionId: ver.id,
          end: next.end,
          partyIds: [...new Set(parties.map((p) => p.partyId))],
          approvals: [...(c.approvals ?? []), approval(ctx, "approve", `条件変更（第${ver.versionNo}版・${effectiveFrom}適用）を確定`, ver.id)],
        });
        txUpdate(tx, ctx, C.contracts, c, expected(v._contractVersion), contractPatch);
        audit(tx, ctx, "contract.version_confirm", C.contracts, c.id, { versionId: ver.id, versionNo: ver.versionNo, effectiveFrom, previous: curVer.id });
      } else {
        txUpdate(tx, ctx, C.contractVersions, ver, expected(v._version), versionPatch);
        if (intent === "submit" && isInitial) {
          const rejected = (c.approvals ?? []).some((a) => a.action === "reject");
          contractPatch.status = "in_review";
          contractPatch.approvals = [...(c.approvals ?? []), approval(ctx, rejected ? "resubmit" : "submit", null, ver.id)];
        }
        txUpdate(tx, ctx, C.contracts, c, expected(v._contractVersion), contractPatch);
        audit(tx, ctx, intent === "submit" ? "contract.submit" : "update", C.contractVersions, ver.id, { contractId: c.id, intent, versionNo: ver.versionNo });
      }
      if (isSale) syncSaleTasks(tx, ctx, c, assigneeUid, next, taskSnaps);
      if (!isInitial && intent !== "confirm") redirect = `/contracts/${contractId}?tab=versions`;
    });
    return { redirect };
  });
}

// ───────────── 売買: 融資期限・書類提出・決済準備のタスク（S14） ─────────────

const SALE_TASKS: { key: string; title: string; due: (v: ContractVersion) => string | null }[] = [
  { key: "loan_deadline", title: "融資承認期限の確認", due: (v) => v.loan?.deadline ?? null },
  {
    key: "documents",
    title: "決済必要書類の提出確認",
    due: (v) => (v.settlementDate ? addDays(v.settlementDate, -14) : null),
  },
  { key: "settlement_prep", title: "決済準備（残代金・登記・鍵の手配）", due: (v) => (v.settlementDate ? addDays(v.settlementDate, -7) : null) },
];

function syncSaleTasks(tx: Transaction, ctx: Ctx, c: Contract, assigneeUid: string | null, v: ContractVersion, snaps: FirebaseFirestore.DocumentSnapshot[]) {
  SALE_TASKS.forEach((t, i) => {
    const due = t.due(v);
    const s = snaps[i];
    const id = `${c.id}__${t.key}`;
    const title = `${t.title}（${c.number}）`;
    if (!s.exists) {
      if (!due) return;
      txCreate(
        tx, ctx, C.tasks,
        { title, due, assigneeUid, entity: "contract", entityId: c.id, done: false, doneBy: null, doneAt: null, storeId: c.storeId, sourceKey: id } satisfies Omit<TaskDoc, keyof BaseDoc>,
        id,
      );
      return;
    }
    const cur = { ...(s.data() as TaskDoc), id: s.id };
    if (cur.companyId !== ctx.companyId || cur.done) return; // 完了済みタスクは変更しない
    if (!due) {
      txUpdate(tx, ctx, C.tasks, cur, null, { archived: true });
      return;
    }
    if (cur.due !== due || cur.title !== title || cur.archived) txUpdate(tx, ctx, C.tasks, cur, null, { due, title, archived: false });
  });
}

// ───────────── ワークフロー（社内承認） ─────────────

async function currentVersionOf(tx: Transaction, ctx: Ctx, c: Contract): Promise<ContractVersion> {
  if (!c.currentVersionId) throw new ValidationError(["契約条件（版）が見つかりません"]);
  return txGet<ContractVersion>(tx, ctx, C.contractVersions, c.currentVersionId);
}

export async function submitContract(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff("contract.write");
    await runOnce(ctx, str(input._requestId), async (tx) => {
      const c = await txGet<Contract>(tx, ctx, C.contracts, str(input.id));
      const ver = await currentVersionOf(tx, ctx, c);
      if (c.status !== "draft") throw new ValidationError(["下書きの契約のみ提出できます"]);
      const e = confirmErrorsOf(c, ver);
      if (e.length) throw new ValidationError(e);
      const rejected = (c.approvals ?? []).some((a) => a.action === "reject");
      txUpdate(tx, ctx, C.contracts, c, null, { status: "in_review", approvals: [...(c.approvals ?? []), approval(ctx, rejected ? "resubmit" : "submit", null, ver.id)] });
      audit(tx, ctx, rejected ? "contract.resubmit" : "contract.submit", C.contracts, c.id, { versionId: ver.id });
      return null;
    });
    return null;
  });
}

function overlapsOf(c: Contract, ver: ContractVersion, others: Contract[]): Contract[] {
  if (c.kind !== "lease" || !c.unitId || !ver.start) return [];
  const occ: OccupancyContract[] = others
    .filter((o) => o.kind === "lease" && o.unitId && o.start && !o.archived)
    .map((o) => ({ id: o.id, unitId: o.unitId!, status: o.status, start: o.start!, end: o.end }));
  const hit = new Set(findOverlappingContracts({ id: c.id, unitId: c.unitId, start: ver.start, end: ver.end }, occ).map((o) => o.id));
  return others.filter((o) => hit.has(o.id));
}

export async function approveContract(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff("contract.approve");
    await runOnce(ctx, str(input._requestId), async (tx) => {
      const c = await txGet<Contract>(tx, ctx, C.contracts, str(input.id));
      const ver = await currentVersionOf(tx, ctx, c);
      const others = c.kind === "lease" && c.unitId ? (await tx.get(col(ctx.companyId, C.contracts).where("unitId", "==", c.unitId))).docs.map((d) => ({ ...(d.data() as Contract), id: d.id })) : [];
      if (c.status !== "in_review") throw new ValidationError(["社内確認中の契約のみ承認できます"]);
      if (!canAccessStore(ctx, c.storeId)) throw new ValidationError(["この店舗の契約を承認する権限がありません"]);
      const e = confirmErrorsOf(c, ver);
      // B04: 同じ部屋の占有期間が重なる確定契約は、管理者の例外記録がない限り承認不可
      const ov = overlapsOf(c, ver, others);
      if (ov.length && !c.overlapException) {
        e.push(
          `同じ部屋で期間が重なる確定契約があります: ${ov.map((o) => `${o.number}（${o.start}〜${o.end ?? "期間の定めなし"}）`).join("、")}。` +
            "現在の契約の終了日以降に開始日を設定するか、会社管理者が例外理由を記録してください",
        );
      }
      if (e.length) throw new ValidationError(e);
      txUpdate(tx, ctx, C.contracts, c, null, { status: "approved", approvals: [...(c.approvals ?? []), approval(ctx, "approve", optStr(input.reason), ver.id)] });
      audit(tx, ctx, "contract.approve", C.contracts, c.id, { versionId: ver.id, overlapException: ov.length ? c.overlapException : null });
      return null;
    });
    return null;
  });
}

export async function rejectContract(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff("contract.approve");
    const reason = optStr(input.reason);
    if (!reason) throw new ValidationError(["差戻し理由を入力してください"]);
    const r = await runOnce(ctx, str(input._requestId), async (tx) => {
      const c = await txGet<Contract>(tx, ctx, C.contracts, str(input.id));
      if (c.status !== "in_review") throw new ValidationError(["社内確認中の契約のみ差し戻せます"]);
      txUpdate(tx, ctx, C.contracts, c, null, { status: "draft", approvals: [...(c.approvals ?? []), approval(ctx, "reject", reason, c.currentVersionId)] });
      audit(tx, ctx, "contract.reject", C.contracts, c.id, { reason });
      const submitter = [...(c.approvals ?? [])].reverse().find((a) => a.action === "submit" || a.action === "resubmit")?.by ?? c.assigneeUid;
      return { id: c.id, number: c.number, toUid: submitter, at: nowIso() };
    });
    if (r) await notify(ctx, { toUid: r.toUid, kind: "contract_rejected", title: `契約 ${r.number} が差し戻されました`, href: `/contracts/${r.id}?tab=approvals`, dedupeKey: `contract_reject:${r.id}:${r.at}` });
    return null;
  });
}

/** B04 例外: 会社管理者が理由を記録した場合のみ、期間の重なる契約を承認できる */
export async function recordOverlapException(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff("contract.approve");
    if (!ctx.user.roles.includes("admin")) throw new ValidationError(["期間重複の例外は会社管理者のみ記録できます"]);
    const reason = optStr(input.reason);
    if (!reason) throw new ValidationError(["例外とする理由を入力してください"]);
    await runOnce(ctx, str(input._requestId), async (tx) => {
      const c = await txGet<Contract>(tx, ctx, C.contracts, str(input.id));
      if (!["draft", "in_review"].includes(c.status)) throw new ValidationError(["承認前の契約にのみ記録できます"]);
      const ex = { reason, approvedBy: ctx.uid, at: nowIso() };
      txUpdate(tx, ctx, C.contracts, c, null, { overlapException: ex });
      audit(tx, ctx, "contract.overlap_exception", C.contracts, c.id, ex);
      return null;
    });
    return null;
  });
}

// ───────────── 締結記録 ─────────────

export async function executeContract(contractId: string, v: Record<string, unknown>): Promise<ActionResult<{ redirect: string }>> {
  return run(async () => {
    const ctx = await requireStaff("contract.write");
    const fe: Record<string, string> = {};
    const attachmentId = str(v.attachmentId);
    if (!attachmentId) fe.attachmentId = "署名済み書類を選択してください（先にファイルを登録してください）";
    const executedAt = str(v.executedAt);
    if (!isValidBizDate(executedAt)) fe.executedAt = "締結日を入力してください";
    const executedBy = str(v.executedBy);
    if (!executedBy) fe.executedBy = "確認者を選択してください";
    if (Object.keys(fe).length) throw new ValidationError(Object.values(fe), fe);
    const today = todayJst();

    await runOnce(ctx, str(v._requestId), async (tx) => {
      const c = await txGet<Contract>(tx, ctx, C.contracts, contractId);
      const ver = await currentVersionOf(tx, ctx, c);
      const att = await txGet<Attachment>(tx, ctx, C.attachments, attachmentId);
      if (!att.linkKeys.includes(`contract:${c.id}`) || att.archived || att.quarantined) throw new ValidationError(["選択した書類はこの契約に登録されていません"]);
      if (c.status !== "approved") throw new ValidationError(["承認済みの契約のみ締結を記録できます"]);
      const unit = c.kind === "lease" && c.unitId ? await txGet<Unit>(tx, ctx, C.units, c.unitId) : null;
      const roleDefs: { partyId: string; role: PartyRoleKind; entity: PartyRole["entity"]; entityId: string }[] = [];
      for (const p of ver.parties) {
        if (c.kind === "lease") {
          if (p.role === "lessee") {
            roleDefs.push({ partyId: p.partyId, role: "lessee", entity: "contract", entityId: c.id });
            if (c.unitId) roleDefs.push({ partyId: p.partyId, role: "tenant", entity: "unit", entityId: c.unitId });
          }
          if (p.role === "lessor") roleDefs.push({ partyId: p.partyId, role: "lessor", entity: "contract", entityId: c.id });
          if (p.role === "guarantor") roleDefs.push({ partyId: p.partyId, role: "guarantor", entity: "contract", entityId: c.id });
          if (p.role === "occupant") roleDefs.push({ partyId: p.partyId, role: "occupant", entity: "contract", entityId: c.id });
        } else if (p.role === "seller" || p.role === "buyer") {
          roleDefs.push({ partyId: p.partyId, role: p.role, entity: "contract", entityId: c.id });
        }
      }
      const roleIds = roleDefs.map((r) => `${r.entity}_${r.entityId}_${r.partyId}_${r.role}`);
      const roleSnaps = roleIds.length ? await tx.getAll(...roleIds.map((id) => ref(ctx, C.partyRoles, id))) : [];
      const partyIds = [...new Set(roleDefs.map((r) => r.partyId))];
      const parties = await Promise.all(partyIds.map((id) => txGet<Party>(tx, ctx, C.parties, id)));

      // ── 書込み ──
      const occupyNow = !!unit && !!ver.start && compare(ver.start, today) <= 0;
      txUpdate(tx, ctx, C.contracts, c, null, {
        status: "executed",
        executedAt,
        executedBy,
        executedDocAttachmentId: att.id,
        start: ver.start,
        end: ver.end,
      });
      txUpdate(tx, ctx, C.contractVersions, ver, null, { status: "confirmed", confirmedBy: executedBy, confirmedAt: nowIso(), effectiveFrom: ver.start ?? ver.effectiveFrom });
      if (unit && occupyNow) txUpdate(tx, ctx, C.units, unit, null, { currentContractId: c.id, occupancy: "occupied", expectedVacancyDate: null });
      roleDefs.forEach((r, i) => {
        if (roleSnaps[i]?.exists) return;
        txCreate(tx, ctx, C.partyRoles, { partyId: r.partyId, role: r.role, entity: r.entity, entityId: r.entityId, from: ver.start, to: ver.end } satisfies Omit<PartyRole, keyof BaseDoc>, roleIds[i]);
      });
      for (const p of parties) {
        const add = roleDefs.filter((r) => r.partyId === p.id).map((r) => r.role);
        if (add.some((r) => !(p.roles ?? []).includes(r))) txUpdate(tx, ctx, C.parties, p, null, { roles: FieldValue.arrayUnion(...add) });
      }
      // 敷金の受入記録（保管主体を記録。貸主保管分は自社の現金として扱わない: T12）
      if (c.kind === "lease" && ver.depositAmount && ver.depositAmount > 0 && c.depositHolder) {
        txCreate(
          tx, ctx, C.deposits,
          {
            contractId: c.id, kind: "receive", amount: ver.depositAmount, date: executedAt, holder: c.depositHolder, approved: true, approvedBy: executedBy,
            reason: "締結記録時の受入（契約条件の敷金額）", moveoutId: null,
          } satisfies Omit<DepositEntryDoc, keyof BaseDoc>,
          `${c.id}__receive_initial`,
        );
      }
      audit(tx, ctx, "contract.execute", C.contracts, c.id, { executedAt, executedBy, attachmentId: att.id, occupyNow, versionId: ver.id });
      return null;
    });
    return { redirect: `/contracts/${contractId}` };
  });
}

/** 締結記録済み → 契約期間中（開始日到来後）。賃貸は部屋を入居中にする */
export async function activateContract(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff("contract.write");
    await runOnce(ctx, str(input._requestId), async (tx) => {
      const c = await txGet<Contract>(tx, ctx, C.contracts, str(input.id));
      const unit = c.kind === "lease" && c.unitId ? await txGet<Unit>(tx, ctx, C.units, c.unitId) : null;
      if (c.status !== "executed") throw new ValidationError(["締結記録済みの契約のみ「契約期間中」にできます"]);
      if (c.start && compare(c.start, todayJst()) > 0) throw new ValidationError([`契約開始日（${c.start}）がまだ到来していません`]);
      txUpdate(tx, ctx, C.contracts, c, null, { status: "active" });
      if (unit) txUpdate(tx, ctx, C.units, unit, null, { currentContractId: c.id, occupancy: "occupied", expectedVacancyDate: null });
      audit(tx, ctx, "contract.activate", C.contracts, c.id);
      return null;
    });
    return null;
  });
}

/** 契約終了（終了日必須）。部屋の現在契約がこの契約なら空室に戻す */
export async function endContract(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff("contract.write");
    const endDate = str(input.reason ?? input.endDate).normalize("NFKC").replace(/\//g, "-");
    if (!isValidBizDate(endDate)) throw new ValidationError(["終了日を YYYY-MM-DD 形式で入力してください"]);
    await runOnce(ctx, str(input._requestId), async (tx) => {
      const c = await txGet<Contract>(tx, ctx, C.contracts, str(input.id));
      const unit = c.kind === "lease" && c.unitId ? await txGet<Unit>(tx, ctx, C.units, c.unitId) : null;
      if (!["executed", "active"].includes(c.status)) throw new ValidationError(["締結記録済み・契約期間中の契約のみ終了できます"]);
      if (c.start && compare(endDate, c.start) < 0) throw new ValidationError(["終了日が契約開始日より前です"]);
      txUpdate(tx, ctx, C.contracts, c, null, { status: "ended", end: endDate });
      if (unit && unit.currentContractId === c.id) txUpdate(tx, ctx, C.units, unit, null, { currentContractId: null, occupancy: "vacant", expectedVacancyDate: null });
      audit(tx, ctx, "contract.end", C.contracts, c.id, { endDate, previousEnd: c.end });
      return null;
    });
    return null;
  });
}

/** 取消（理由必須）。締結記録後の取消は承認権限が必要。金銭記録は自動削除しない */
export async function cancelContract(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff("contract.write");
    const reason = optStr(input.reason);
    if (!reason) throw new ValidationError(["取消理由を入力してください"]);
    await runOnce(ctx, str(input._requestId), async (tx) => {
      const c = await txGet<Contract>(tx, ctx, C.contracts, str(input.id));
      const unit = c.kind === "lease" && c.unitId ? await txGet<Unit>(tx, ctx, C.units, c.unitId) : null;
      if (["ended", "cancelled"].includes(c.status)) throw new ValidationError(["終了・取消済みの契約は取り消せません"]);
      if (["executed", "active"].includes(c.status) && !ctx.caps.has("contract.approve")) throw new ValidationError(["締結記録後の取消には契約承認権限が必要です"]);
      txUpdate(tx, ctx, C.contracts, c, null, { status: "cancelled", cancelReason: reason, cancelledBy: ctx.uid, cancelledAt: nowIso() });
      if (unit && unit.currentContractId === c.id) txUpdate(tx, ctx, C.units, unit, null, { currentContractId: null, occupancy: "vacant" });
      audit(tx, ctx, "contract.cancel", C.contracts, c.id, { reason, previousStatus: c.status });
      return null;
    });
    return null;
  });
}

// ───────────── 条件変更（B05: 新しい版） ─────────────

export async function createChangeVersion(contractId: string, v: Record<string, unknown>): Promise<ActionResult<{ redirect: string }>> {
  return run(async () => {
    const ctx = await requireStaff("contract.write");
    const fe: Record<string, string> = {};
    const effectiveFrom = optDate(v.effectiveFrom, "effectiveFrom", fe);
    const changeReason = optStr(v.changeReason);
    if (!changeReason) fe.changeReason = "変更理由を入力してください";
    if (Object.keys(fe).length) throw new ValidationError(Object.values(fe), fe);
    const id = await runOnce(ctx, str(v._requestId), async (tx) => {
      const c = await txGet<Contract>(tx, ctx, C.contracts, contractId);
      const cur = await currentVersionOf(tx, ctx, c);
      const all = (await tx.get(col(ctx.companyId, C.contractVersions).where("contractId", "==", c.id))).docs.map((d) => d.data() as ContractVersion);
      if (!["executed", "active"].includes(c.status)) throw new ValidationError(["条件変更は締結記録済み・契約期間中の契約で行えます"]);
      if (all.some((x) => x.status === "draft" && !x.archived)) throw new ValidationError(["未確定の変更版があります。先にその版を確定するか破棄してください"]);
      const e = validateChangeEffectiveFrom(cur.effectiveFrom, effectiveFrom, c.kind === "lease" ? c.end : null);
      if (e.length) throw new ValidationError(e, { effectiveFrom: e[0] });
      const versionNo = Math.max(...all.map((x) => x.versionNo)) + 1;
      const copy = Object.fromEntries(Object.entries(cur).filter(([k]) => !["id", "companyId", "createdAt", "updatedAt", "createdBy", "updatedBy", "version", "archived"].includes(k)));
      const nid = txCreate(tx, ctx, C.contractVersions, {
        ...(copy as Omit<ContractVersion, keyof BaseDoc>),
        versionNo,
        effectiveFrom: effectiveFrom!,
        effectiveTo: null,
        status: "draft",
        confirmedBy: null,
        confirmedAt: null,
        changeReason,
      });
      audit(tx, ctx, "contract.version_create", C.contractVersions, nid, { contractId: c.id, versionNo, effectiveFrom, from: cur.id });
      return nid;
    });
    return { redirect: `/contracts/${contractId}/edit?versionId=${id}` };
  });
}

export async function discardChangeVersion(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff("contract.write");
    await adminDb().runTransaction(async (tx) => {
      const ver = await txGet<ContractVersion>(tx, ctx, C.contractVersions, str(input.versionId));
      const c = await txGet<Contract>(tx, ctx, C.contracts, ver.contractId);
      if (ver.status !== "draft" || c.currentVersionId === ver.id) throw new ValidationError(["未確定の変更版のみ破棄できます"]);
      txUpdate(tx, ctx, C.contractVersions, ver, null, { archived: true });
      audit(tx, ctx, "contract.version_discard", C.contractVersions, ver.id, { contractId: c.id, versionNo: ver.versionNo, reason: optStr(input.reason) });
    });
    return null;
  });
}
