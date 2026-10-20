import "server-only";
import type { Transaction } from "firebase-admin/firestore";
import { adminDb } from "../firebase-admin";
import { Ctx } from "../session";
import { col, ref, findDocs, getMany, txGet, txCreate, txUpdate, audit, keywords, txNextNumber, ValidationError, nowIso } from "../repo";
import { companySettings, itemTypes } from "../lookups";
import { DEFAULT_ITEM_TYPES } from "@/lib/defaults";
import { C, Allocation, Contract, ContractVersion, Estimate, Invoice, InvoiceLine, Ownership, Party, Property, Repair, Settlement, Unit } from "@/lib/types";
import { planMonthlyCharges, splitAmongOwners, ContractVersionForBilling, PlannedCharge } from "@/lib/domain/rules";
import { addDays, monthEnd, monthStart, periodsOverlap, todayJst } from "@/lib/domain/dates";
import {
  collectedRowsOf, computeOwnerSettlement, dueDateFor, invoiceTotals, isPeriodLocked, isValidPeriod, ownershipActiveIn, PropertyFeeGroup, ratioToDecimal,
  recalcDiff, selectSettlementAllocations,
} from "@/lib/domain/billing";

// 請求モジュールのサーバー共通処理（月次請求作成・再計算・月次締めの確認）。
// "use server" ファイルではない（ここの関数はクライアントから直接呼べない）。

/** 費目一覧（会社設定が未登録なら初期費目） */
export async function itemTypeList(ctx: Pick<Ctx, "companyId">): Promise<{ code: string; name: string; kind: string; tax: import("@/lib/domain/money").TaxSetting; managementFeeTarget: boolean; isDeposit: boolean; sort: number }[]> {
  const list = await itemTypes(ctx.companyId);
  if (list.length) return list;
  return DEFAULT_ITEM_TYPES.map((t) => ({ ...t }));
}

// ───────────── B25: 月次締め ─────────────

export interface PeriodLockDoc {
  id: string; // YYYY-MM
  companyId: string;
  period: string;
  locked: boolean;
  closedAt: string | null;
  closedBy: string | null;
  unlockedAt: string | null;
  unlockedBy: string | null;
  unlockReason: string | null;
  recheckedAt?: string | null;
  recheckedBy?: string | null;
  history: { action: "close" | "unlock"; by: string; byName: string; at: string; reason: string | null }[];
  updatedAt: string;
}

export function companyRef(ctx: Pick<Ctx, "companyId">) {
  return adminDb().collection("companies").doc(ctx.companyId);
}

/** トランザクション内（読込みフェーズ）で締め状態を確認し、締め済みなら ValidationError */
export async function txAssertPeriodsOpen(tx: Transaction, ctx: Ctx, periods: (string | null | undefined)[], what = "この操作"): Promise<void> {
  const ps = [...new Set(periods.filter((p): p is string => !!p && isValidPeriod(p)))];
  if (!ps.length) return;
  const [company, ...locks] = await tx.getAll(companyRef(ctx), ...ps.map((p) => col(ctx.companyId, C.periodLocks).doc(p)));
  const closedThrough = (company.data()?.settings?.closedThrough as string | null) ?? null;
  const locked = locks.filter((s) => s.exists && s.data()!.locked).map((s) => s.id);
  const bad = ps.filter((p) => isPeriodLocked(p, closedThrough, locked));
  if (bad.length) throw new ValidationError([`${bad.join("・")} は月次締め済みのため${what}はできません。管理者による締め解除が必要です。`]);
}

/** 画面表示用: 締め状態 */
export async function lockState(ctx: Ctx): Promise<{ closedThrough: string | null; locks: PeriodLockDoc[] }> {
  const [company, snap] = await Promise.all([companyRef(ctx).get(), col(ctx.companyId, C.periodLocks).limit(240).get()]);
  const locks = snap.docs.map((d) => ({ ...(d.data() as PeriodLockDoc), id: d.id })).sort((a, b) => b.period.localeCompare(a.period));
  return { closedThrough: (company.data()?.settings?.closedThrough as string | null) ?? null, locks };
}

export async function isLocked(ctx: Ctx, period: string | null | undefined): Promise<boolean> {
  if (!period) return false;
  const { closedThrough, locks } = await lockState(ctx);
  return isPeriodLocked(period, closedThrough, locks.filter((l) => l.locked).map((l) => l.period));
}

// ───────────── B05/B06: 月次請求 ─────────────

export interface PlannedChargeSummary extends PlannedCharge {
  status: "new" | "existing";
  contractNumber: string;
  contractTitle: string;
  billToName: string;
  invoiceId: string | null; // 既存分の請求
}

interface BillingTarget {
  contract: Contract;
  versions: ContractVersion[];
  forBilling: ContractVersionForBilling[];
  lessee: { partyId: string; name: string; kana: string | null } | null;
  latest: ContractVersion;
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** 締結記録済み・契約期間中の賃貸契約と、確定済み契約版（適用期間つき）を読み込む */
export async function loadBillingTargets(ctx: Ctx, period: string, contractIds?: string[]): Promise<BillingTarget[]> {
  let contracts: Contract[];
  if (contractIds?.length) {
    contracts = [...(await getMany<Contract>(ctx, C.contracts, contractIds)).values()].filter((c) => ["executed", "active"].includes(c.status));
  } else {
    contracts = await findDocs<Contract>(ctx, C.contracts, [["status", "in", ["executed", "active"]]], 5000);
  }
  contracts = contracts.filter((c) => !c.archived && c.kind === "lease");
  const versionsByContract = new Map<string, ContractVersion[]>();
  for (const ids of chunk(contracts.map((c) => c.id), 30)) {
    const vs = await findDocs<ContractVersion>(ctx, C.contractVersions, [["contractId", "in", ids], ["status", "==", "confirmed"]], 2000);
    for (const v of vs) versionsByContract.set(v.contractId, [...(versionsByContract.get(v.contractId) ?? []), v]);
  }
  const ms = monthStart(period);
  const me = monthEnd(period);
  const out: BillingTarget[] = [];
  for (const c of contracts) {
    const vs = (versionsByContract.get(c.id) ?? []).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || a.versionNo - b.versionNo);
    if (!vs.length) continue;
    const forBilling: ContractVersionForBilling[] = [];
    vs.forEach((v, i) => {
      const next = vs[i + 1];
      let to = v.effectiveTo;
      if (next) {
        const dayBefore = addDays(next.effectiveFrom, -1);
        if (!to || to > dayBefore) to = dayBefore;
      }
      const start = v.start ?? c.start;
      if (!start) return;
      if (to && to < v.effectiveFrom) return; // 同日に次版が適用される版
      if (!periodsOverlap({ start: v.effectiveFrom, end: to }, { start: ms, end: me })) return;
      forBilling.push({
        contractId: c.id,
        versionId: v.id,
        versionNo: v.versionNo,
        effectiveFrom: v.effectiveFrom,
        effectiveTo: to,
        contractStart: start,
        contractEnd: v.end ?? c.end,
        monthlyItems: v.monthlyItems ?? [],
      });
    });
    if (!forBilling.length) continue;
    const latest = vs.find((v) => v.id === forBilling[forBilling.length - 1].versionId)!;
    const l = latest.parties?.find((p) => p.role === "lessee");
    out.push({ contract: c, versions: vs, forBilling, latest, lessee: l ? { partyId: l.partyId, name: l.name, kana: l.kana } : null });
  }
  return out;
}

export function planForTarget(period: string, t: BillingTarget): PlannedCharge[] {
  return planMonthlyCharges(period, t.forBilling);
}

function lineOf(p: PlannedCharge): InvoiceLine {
  return {
    itemCode: p.itemCode,
    name: p.itemName,
    quantity: "1",
    unitPrice: String(p.amount),
    amount: p.amount,
    tax: p.tax,
    period: p.period,
    from: p.from,
    to: p.to,
    formula: p.formula,
    dedupeKey: p.dedupeKey,
    contractVersionId: p.versionId,
    adjustsInvoiceId: null,
  };
}

/**
 * B05/B06/T05: 対象月の月額請求を作成する。
 * - 重複防止キー（chargeKeys/{dedupeKey}）を請求と同じトランザクションで作成する。既に存在するキーは「作成済み」。
 * - 同じ契約・対象月の下書き請求があれば、その請求へ新しい明細だけを追加する（契約ごと・月ごとに1件）。
 * - 2回実行しても新しい請求は作られない。確定済み請求には触れない。
 */
export async function generateMonthlyInvoices(
  ctx: Ctx,
  period: string,
  opts?: { contractIds?: string[]; dryRun?: boolean },
): Promise<{ planned: PlannedChargeSummary[]; created: number; existing: number; invoiceIds: string[]; skipped: { contractId: string; contractNumber: string; reason: string }[] }> {
  if (!isValidPeriod(period)) throw new ValidationError(["対象月は YYYY-MM 形式で指定してください"]);
  const settings = await companySettings(ctx.companyId);
  const targets = await loadBillingTargets(ctx, period, opts?.contractIds);
  const unitMap = await getMany<Unit>(ctx, C.units, targets.map((t) => t.contract.unitId ?? "").filter(Boolean));

  const planned: PlannedChargeSummary[] = [];
  const skipped: { contractId: string; contractNumber: string; reason: string }[] = [];
  const perContract: { t: BillingTarget; plan: PlannedCharge[] }[] = [];
  for (const t of targets) {
    let plan: PlannedCharge[];
    try {
      plan = planForTarget(period, t);
    } catch (e) {
      skipped.push({ contractId: t.contract.id, contractNumber: t.contract.number, reason: `計算できません: ${(e as Error).message}` });
      continue;
    }
    if (!plan.length) continue;
    if (!t.lessee) {
      skipped.push({ contractId: t.contract.id, contractNumber: t.contract.number, reason: "借主（請求先）が契約版に登録されていません" });
      continue;
    }
    perContract.push({ t, plan });
  }

  // 既存キーの確認（表示用。作成時はトランザクション内で再確認する）
  const allKeys = perContract.flatMap((x) => x.plan.map((p) => p.dedupeKey));
  const existingKeys = new Map<string, string>();
  for (const ids of chunk(allKeys, 300)) {
    if (!ids.length) continue;
    const snaps = await adminDb().getAll(...ids.map((k) => ref(ctx, C.chargeKeys, k)));
    for (const s of snaps) if (s.exists) existingKeys.set(s.id, (s.data()!.invoiceId as string) ?? null);
  }
  for (const { t, plan } of perContract) {
    for (const p of plan) {
      planned.push({
        ...p,
        status: existingKeys.has(p.dedupeKey) ? "existing" : "new",
        contractNumber: t.contract.number,
        contractTitle: t.contract.title,
        billToName: t.lessee!.name,
        invoiceId: existingKeys.get(p.dedupeKey) ?? null,
      });
    }
  }
  if (opts?.dryRun) {
    return { planned, created: 0, existing: planned.filter((p) => p.status === "existing").length, invoiceIds: [], skipped };
  }

  let created = 0;
  let existing = 0;
  const invoiceIds: string[] = [];
  const today = todayJst();
  for (const { t, plan } of perContract) {
    const r = await adminDb().runTransaction(async (tx) => {
      await txAssertPeriodsOpen(tx, ctx, [period], "請求の作成");
      const snaps = await tx.getAll(...plan.map((p) => ref(ctx, C.chargeKeys, p.dedupeKey)));
      const fresh = plan.filter((_, i) => !snaps[i].exists);
      if (!fresh.length) return { created: 0, existing: plan.length, invoiceId: null as string | null };
      const draftSnap = await tx.get(
        col(ctx.companyId, C.invoices)
          .where("contractId", "==", t.contract.id)
          .where("period", "==", period)
          .where("kind", "==", "monthly")
          .where("status", "==", "draft")
          .limit(1),
      );
      const newLines = fresh.map(lineOf);
      let invoiceId: string;
      if (!draftSnap.empty) {
        const cur = { ...(draftSnap.docs[0].data() as Invoice), id: draftSnap.docs[0].id };
        const lines = [...cur.lines, ...newLines];
        const tot = invoiceTotals(lines, settings.taxRounding ?? "floor");
        txUpdate(tx, ctx, C.invoices, cur, null, { lines, subtotal: tot.subtotal, tax: tot.tax, total: tot.total });
        invoiceId = cur.id;
        audit(tx, ctx, "invoice.monthly_append", C.invoices, invoiceId, { period, keys: fresh.map((f) => f.dedupeKey) });
      } else {
        const number = await txNextNumber(tx, ctx, "invoice", "INV-");
        const tot = invoiceTotals(newLines, settings.taxRounding ?? "floor");
        const unit = t.contract.unitId ? unitMap.get(t.contract.unitId) : undefined;
        const data: Omit<Invoice, keyof import("../repo").BaseDoc> = {
          number,
          kind: "monthly",
          status: "draft",
          billToPartyId: t.lessee!.partyId,
          billToName: t.lessee!.name,
          contractId: t.contract.id,
          unitId: t.contract.unitId,
          propertyId: unit?.propertyId ?? t.contract.propertyIds?.[0] ?? null,
          storeId: t.contract.storeId,
          period,
          issueDate: today,
          dueDate: dueDateFor(period, t.latest.paymentDueDay, t.latest.paymentTiming ?? "prev_month"),
          lines: newLines,
          subtotal: tot.subtotal,
          tax: tot.tax,
          total: tot.total,
          paid: 0,
          paidState: "none",
          confirmedAt: null,
          confirmedBy: null,
          cancelOf: null,
          correctedBy: null,
          cancelReason: null,
          payerKana: [t.lessee!.kana, t.lessee!.name].filter((x): x is string => !!x),
          keywords: keywords(number, t.lessee!.name, t.lessee!.kana, t.contract.number, t.contract.title, period),
        };
        invoiceId = txCreate(tx, ctx, C.invoices, data);
        audit(tx, ctx, "invoice.monthly_create", C.invoices, invoiceId, { number, period, contractId: t.contract.id, total: tot.total });
      }
      for (const p of fresh) {
        txCreate(tx, ctx, C.chargeKeys, { invoiceId, contractId: p.contractId, period, itemCode: p.itemCode, kind: "monthly" }, p.dedupeKey);
      }
      return { created: fresh.length, existing: plan.length - fresh.length, invoiceId };
    });
    created += r.created;
    existing += r.existing;
    if (r.invoiceId) invoiceIds.push(r.invoiceId);
  }
  return { planned, created, existing, invoiceIds: [...new Set(invoiceIds)], skipped };
}

// ───────────── B05: 再計算候補 ─────────────

export interface RecalcCandidate {
  invoice: Invoice;
  reasons: string[];
}

/** 下書きの月額請求のうち、現在の契約版で計画した明細と一致しないもの（確定済みは対象外） */
export async function findRecalcCandidates(ctx: Ctx, period?: string): Promise<RecalcCandidate[]> {
  const where: [string, FirebaseFirestore.WhereFilterOp, unknown][] = [["kind", "==", "monthly"], ["status", "==", "draft"]];
  if (period) where.push(["period", "==", period]);
  const drafts = (await findDocs<Invoice>(ctx, C.invoices, where, 1000)).filter((i) => !i.archived && i.contractId && i.period);
  const out: RecalcCandidate[] = [];
  const byPeriod = new Map<string, Invoice[]>();
  for (const d of drafts) byPeriod.set(d.period!, [...(byPeriod.get(d.period!) ?? []), d]);
  for (const [p, invs] of byPeriod) {
    const targets = await loadBillingTargets(ctx, p, [...new Set(invs.map((i) => i.contractId!))]);
    const tmap = new Map(targets.map((t) => [t.contract.id, t]));
    for (const inv of invs) {
      const t = tmap.get(inv.contractId!);
      let plan: PlannedCharge[] = [];
      try {
        plan = t ? planForTarget(p, t) : [];
      } catch {
        plan = [];
      }
      const d = recalcDiff(inv.lines, plan);
      if (d.changed) out.push({ invoice: inv, reasons: t ? d.reasons : ["契約が締結記録済み・契約期間中ではないか、確定済みの契約版がありません", ...d.reasons] });
    }
  }
  return out.sort((a, b) => (a.invoice.period ?? "").localeCompare(b.invoice.period ?? "") || a.invoice.number.localeCompare(b.invoice.number));
}

/**
 * B05: 下書き請求の自動作成明細を現在の契約版から作り直す。
 * この請求が持つ重複防止キーのうち不要になったものを削除し、新たに必要なキーを作成する。
 * 他の請求が既に持つキー（作成済み分）は取り込まない。手入力の明細は残す。
 */
export async function recalcDraftInvoice(ctx: Ctx, invoiceId: string): Promise<{ changed: boolean }> {
  const settings = await companySettings(ctx.companyId);
  const pre = await col(ctx.companyId, C.invoices).doc(invoiceId).get();
  if (!pre.exists || pre.data()!.companyId !== ctx.companyId) throw new ValidationError(["請求が見つかりません"]);
  const preInv = pre.data() as Invoice;
  if (preInv.kind !== "monthly" || !preInv.period || !preInv.contractId) throw new ValidationError(["月額請求のみ再計算できます"]);
  const targets = await loadBillingTargets(ctx, preInv.period, [preInv.contractId]);
  const plan = targets[0] ? planForTarget(preInv.period, targets[0]) : [];
  return adminDb().runTransaction(async (tx) => {
    const inv = await txGet<Invoice>(tx, ctx, C.invoices, invoiceId);
    if (inv.status !== "draft") throw new ValidationError(["確定済み・取消済みの請求は再計算しません"]);
    await txAssertPeriodsOpen(tx, ctx, [inv.period], "再計算");
    const oldKeys = inv.lines.map((l) => l.dedupeKey).filter((k): k is string => !!k);
    const allKeys = [...new Set([...oldKeys, ...plan.map((p) => p.dedupeKey)])];
    const snaps = allKeys.length ? await tx.getAll(...allKeys.map((k) => ref(ctx, C.chargeKeys, k))) : [];
    const owner = new Map(snaps.map((s) => [s.id, s.exists ? ((s.data()!.invoiceId as string) ?? null) : null]));
    const usable = plan.filter((p) => !owner.get(p.dedupeKey) || owner.get(p.dedupeKey) === inv.id);
    const manual = inv.lines.filter((l) => !l.dedupeKey);
    const lines = [...usable.map(lineOf), ...manual];
    const tot = invoiceTotals(lines, settings.taxRounding ?? "floor");
    const keep = new Set(usable.map((p) => p.dedupeKey));
    for (const k of allKeys) {
      const o = owner.get(k);
      if (o === inv.id && !keep.has(k)) tx.delete(ref(ctx, C.chargeKeys, k));
    }
    for (const p of usable) {
      if (!owner.get(p.dedupeKey)) txCreate(tx, ctx, C.chargeKeys, { invoiceId: inv.id, contractId: p.contractId, period: p.period, itemCode: p.itemCode, kind: "monthly" }, p.dedupeKey);
    }
    txUpdate(tx, ctx, C.invoices, inv, null, { lines, subtotal: tot.subtotal, tax: tot.tax, total: tot.total, recalculatedAt: nowIso() });
    audit(tx, ctx, "invoice.recalc", C.invoices, inv.id, {
      before: inv.lines.map((l) => ({ key: l.dedupeKey, amount: l.amount, version: l.contractVersionId })),
      after: lines.map((l) => ({ key: l.dedupeKey, amount: l.amount, version: l.contractVersionId })),
    });
    return { changed: true };
  });
}

// ───────────── S18 オーナー精算 ─────────────

export interface SettlementExtra {
  expenseRepairIds?: string[];
  correctedBy?: string | null;
  depositTotal?: number;
  ownerShares?: { ownerId: string; name: string; ratio: string }[];
  remainderTo?: string | null;
  note?: string | null;
  collectedDetail?: { allocationId: string; propertyId: string; itemCode: string; amount: number }[];
}

export interface SettlementComputation {
  propertyIds: string[];
  propertyNames: Record<string, string>;
  allocationIds: string[];
  calc: NonNullable<Settlement["calc"]>;
  ownerSplit: { ownerId: string; amount: number }[];
  ownerShares: { ownerId: string; name: string; ratio: string }[];
  remainderTo: string;
  depositTotal: number;
  collectedDetail: { allocationId: string; propertyId: string; itemCode: string; amount: number }[];
}

/**
 * 精算の計算（B17–B20）。
 * 対象物件 = 対象月に有効なオーナーの所有関係。回収額 = 未精算・未取消の入金配分（入金日が対象月末以前）。
 * 預り金（敷金など）の費目は収入から除外。管理料は所有関係の設定（対象費目未指定なら費目設定の管理料対象）。
 */
export async function computeSettlementData(
  ctx: Ctx,
  ownerPartyId: string,
  period: string,
  expenses: { amount: number }[],
  carryIn: number,
): Promise<SettlementComputation> {
  if (!isValidPeriod(period)) throw new ValidationError(["対象月は YYYY-MM 形式で指定してください"]);
  const mine = (await findDocs<Ownership>(ctx, C.ownerships, [["partyId", "==", ownerPartyId]], 500)).filter((o) => !o.archived && ownershipActiveIn(o, period));
  if (!mine.length) throw new ValidationError([`${period} に有効な所有関係（物件）がありません`]);
  const propertyIds = [...new Set(mine.map((o) => o.propertyId))];
  const all: Ownership[] = [];
  for (const ids of chunk(propertyIds, 30)) {
    all.push(...(await findDocs<Ownership>(ctx, C.ownerships, [["propertyId", "in", ids]], 2000)).filter((o) => !o.archived && ownershipActiveIn(o, period)));
  }
  // 共有者の構成（物件ごとに同じであること）
  const ownerSetOf = (pid: string) => [...new Set(all.filter((o) => o.propertyId === pid).map((o) => o.partyId))].sort().join(",");
  const sets = new Set(propertyIds.map(ownerSetOf));
  if (sets.size > 1) throw new ValidationError(["共有者の構成が異なる物件が含まれています。共有者が同じ物件ごとに精算してください（所有関係を確認してください）"]);
  const firstProp = propertyIds[0];
  const owners = all.filter((o) => o.propertyId === firstProp);
  const parties = await getMany<Party>(ctx, C.parties, owners.map((o) => o.partyId));
  const ownerShares = owners.map((o) => ({
    ownerId: o.partyId,
    name: parties.get(o.partyId)?.name ?? "（不明）",
    ratio: owners.length === 1 ? "1" : ratioToDecimal(o.remitRatio) ?? ratioToDecimal(o.share) ?? "0",
  }));
  const remainderTo = owners.find((o) => o.remainderReceiver)?.partyId ?? ownerPartyId;

  const allocs: Allocation[] = [];
  for (const ids of chunk(propertyIds, 30)) {
    allocs.push(...(await findDocs<Allocation>(ctx, C.allocations, [["propertyId", "in", ids], ["settlementId", "==", null], ["reversed", "==", false]], 5000)));
  }
  const target = selectSettlementAllocations(allocs, propertyIds, period);
  const types = await itemTypeList(ctx);
  const depositCodes = new Set(types.filter((t) => t.isDeposit).map((t) => t.code));
  const feeTargetDefault = types.filter((t) => t.managementFeeTarget).map((t) => t.code);
  const { rows, depositTotal } = collectedRowsOf(target, depositCodes);
  const props = await getMany<Property>(ctx, C.properties, propertyIds);
  const groups: PropertyFeeGroup[] = propertyIds.map((pid) => {
    const own = mine.find((o) => o.propertyId === pid && o.managementFee) ?? all.find((o) => o.propertyId === pid && o.managementFee);
    const fee = own?.managementFee ?? null;
    return {
      propertyId: pid,
      label: props.get(pid)?.name ?? pid,
      fee: fee ? { ...fee, targetItemCodes: fee.targetItemCodes?.length ? fee.targetItemCodes : feeTargetDefault } : null,
    };
  });
  const calc = computeOwnerSettlement(rows, groups, expenses, carryIn, depositTotal);
  let ownerSplit: { ownerId: string; amount: number }[];
  if (ownerShares.length > 1) {
    try {
      ownerSplit = splitAmongOwners(calc.payable, ownerShares.map((s) => ({ ownerId: s.ownerId, ratio: s.ratio })), remainderTo);
    } catch (e) {
      throw new ValidationError([`共有所有者への送金配分を計算できません: ${(e as Error).message}（所有関係の送金配分率を確認してください）`]);
    }
  } else ownerSplit = [{ ownerId: ownerPartyId, amount: calc.payable }];
  return {
    propertyIds,
    propertyNames: Object.fromEntries(propertyIds.map((p) => [p, props.get(p)?.name ?? p])),
    allocationIds: target.map((a) => a.id),
    calc,
    ownerSplit,
    ownerShares,
    remainderTo,
    depositTotal,
    collectedDetail: rows.map((r) => ({ allocationId: r.allocationId, propertyId: r.propertyId, itemCode: r.itemCode, amount: r.amount })),
  };
}

/** 立替費用の候補: 対象物件の完了済み修繕で、承認済み見積の貸主負担額。他の精算で使用済みのものは除く */
export async function repairExpenseCandidates(ctx: Ctx, propertyIds: string[], excludeSettlementId: string | null) {
  const repairs: Repair[] = [];
  for (const ids of chunk(propertyIds, 30)) {
    repairs.push(...(await findDocs<Repair>(ctx, C.repairs, [["propertyId", "in", ids], ["status", "==", "completed"]], 1000)));
  }
  if (!repairs.length) return [];
  const used = new Set<string>();
  for (const ids of chunk(repairs.map((r) => r.id), 30)) {
    const ss = await findDocs<Settlement & SettlementExtra>(ctx, C.settlements, [["expenseRepairIds", "array-contains-any", ids]], 1000);
    for (const s of ss) if (s.id !== excludeSettlementId && s.status !== "corrected") for (const rid of s.expenseRepairIds ?? []) used.add(rid);
  }
  const ests = await getMany<Estimate>(ctx, C.estimates, repairs.map((r) => r.approvedEstimateId ?? "").filter(Boolean));
  return repairs
    .filter((r) => !used.has(r.id) && r.approvedEstimateId && ests.get(r.approvedEstimateId))
    .map((r) => {
      const e = ests.get(r.approvedEstimateId!)!;
      const lessor = e.lines.reduce((s, l) => s + l.burden.filter((b) => b.party === "lessor").reduce((x, b) => x + b.amount, 0), 0);
      return { repairId: r.id, name: `修繕 ${r.number} ${r.symptom}`.slice(0, 120), amount: lessor, propertyId: r.propertyId, completedAt: r.completedAt };
    })
    .filter((x) => x.amount !== 0);
}
