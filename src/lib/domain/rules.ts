import Decimal from "decimal.js";
import { BizDate, monthEnd, monthStart, periodsOverlap, compare, todayJst } from "./dates";
import { DEFAULT_PRORATION, ProrationSetting, Rounding, TaxSetting, prorate, roundYen } from "./money";

// ───────────────────────── B04: 契約期間の重複 ─────────────────────────

export interface OccupancyContract {
  id: string;
  unitId: string;
  status: string;
  start: BizDate;
  end: BizDate | null;
}

/** 確定扱いの契約状態（下書き・取消は占有に数えない） */
export const OCCUPYING_CONTRACT_STATUSES = ["approved", "executed", "active"] as const;

export function findOverlappingContracts(
  target: { id?: string; unitId: string; start: BizDate; end: BizDate | null },
  others: OccupancyContract[],
): OccupancyContract[] {
  return others.filter(
    (c) =>
      c.id !== target.id &&
      c.unitId === target.unitId &&
      (OCCUPYING_CONTRACT_STATUSES as readonly string[]).includes(c.status) &&
      periodsOverlap({ start: c.start, end: c.end }, { start: target.start, end: target.end }),
  );
}

// ───────────────────────── B03: 契約確定時の検証 ─────────────────────────

export interface ContractForConfirm {
  partyCount: { lessor: number; lessee: number };
  unitId: string | null;
  start: BizDate | null;
  end: BizDate | null;
  monthlyItems: { code: string; amount: number }[];
  requiredItemCodes: string[];
  documentsChecked: boolean;
}

export function validateContractConfirm(c: ContractForConfirm): string[] {
  const e: string[] = [];
  if (c.partyCount.lessor < 1) e.push("貸主が登録されていません");
  if (c.partyCount.lessee < 1) e.push("借主が登録されていません");
  if (!c.unitId) e.push("対象の部屋・区画が選択されていません");
  if (!c.start) e.push("契約開始日が入力されていません");
  if (c.start && c.end && compare(c.start, c.end) > 0) e.push("契約終了日が開始日より前です");
  for (const code of c.requiredItemCodes) {
    const item = c.monthlyItems.find((i) => i.code === code);
    if (!item) e.push(`必須費目「${code}」が設定されていません`);
  }
  if (!c.documentsChecked) e.push("契約書類の確認が完了していません");
  return e;
}

// ───────────────────────── B06/B07: 月額請求の作成計画 ─────────────────────────

export interface MonthlyItem {
  code: string; // 費目コード（rent, common_fee, parking ...）
  name: string;
  amount: number; // 月額（円）
  tax: TaxSetting;
  proration: ProrationSetting;
}

export interface ContractVersionForBilling {
  contractId: string;
  versionId: string;
  versionNo: number;
  effectiveFrom: BizDate; // 版の適用開始日
  effectiveTo: BizDate | null; // 版の適用終了日（次版の前日）
  contractStart: BizDate;
  contractEnd: BizDate | null;
  monthlyItems: MonthlyItem[];
}

export interface PlannedCharge {
  /** B06: 契約・対象期間・費目・請求種別 の一意キー */
  dedupeKey: string;
  contractId: string;
  versionId: string;
  period: string; // YYYY-MM
  itemCode: string;
  itemName: string;
  from: BizDate;
  to: BizDate;
  amount: number;
  formula: string;
  tax: TaxSetting;
}

export function chargeKey(contractId: string, period: string, itemCode: string, kind = "monthly"): string {
  return `${contractId}__${period}__${itemCode}__${kind}`;
}

/** 対象月の月額請求明細を契約版から計画する。複数版にまたがる場合は版ごとに日割りする。 */
export function planMonthlyCharges(period: string, versions: ContractVersionForBilling[]): PlannedCharge[] {
  const ms = monthStart(period);
  const me = monthEnd(period);
  const out: PlannedCharge[] = [];
  const byItem = new Map<string, PlannedCharge[]>();
  for (const v of versions) {
    const from = maxDate(ms, v.effectiveFrom, v.contractStart);
    const to = minDate(me, v.effectiveTo, v.contractEnd);
    if (compare(from, to) > 0) continue;
    for (const item of v.monthlyItems) {
      const p = prorate(item.amount, from, to, item.proration ?? DEFAULT_PRORATION);
      const c: PlannedCharge = {
        dedupeKey: chargeKey(v.contractId, period, item.code),
        contractId: v.contractId,
        versionId: v.versionId,
        period,
        itemCode: item.code,
        itemName: item.name,
        from,
        to,
        amount: p.amount,
        formula: p.formula,
        tax: item.tax,
      };
      const list = byItem.get(item.code) ?? [];
      list.push(c);
      byItem.set(item.code, list);
    }
  }
  // 同一費目が版をまたいだ場合は1明細に合算し、計算式を併記する（キーは1つ）
  for (const [, list] of byItem) {
    if (list.length === 1) out.push(list[0]);
    else {
      const last = list[list.length - 1];
      out.push({
        ...last,
        from: list[0].from,
        amount: list.reduce((s, c) => s + c.amount, 0),
        formula: list.map((c) => `[${c.from}〜${c.to}] ${c.formula}`).join(" ／ "),
      });
    }
  }
  return out;
}

/** B06: 既存キーと照合して新規作成分と既存分を分ける */
export function splitNewAndExisting<T extends { dedupeKey: string }>(planned: T[], existingKeys: Set<string>) {
  return {
    toCreate: planned.filter((p) => !existingKeys.has(p.dedupeKey)),
    existing: planned.filter((p) => existingKeys.has(p.dedupeKey)),
  };
}

function maxDate(...ds: (BizDate | null)[]): BizDate {
  return ds.filter((d): d is BizDate => !!d).reduce((a, b) => (a > b ? a : b));
}
function minDate(...ds: (BizDate | null)[]): BizDate {
  return ds.filter((d): d is BizDate => !!d).reduce((a, b) => (a < b ? a : b));
}

// ───────────────────────── 請求の入金状態（自由入力しない） ─────────────────────────

export type InvoiceStatus = "draft" | "confirmed" | "cancelled";
export type PaymentState = "unpaid" | "partial" | "paid" | "overdue" | "n/a";

export function derivePaymentState(
  inv: { status: InvoiceStatus; total: number; paid: number; dueDate: BizDate | null },
  today: BizDate = todayJst(),
): PaymentState {
  if (inv.status !== "confirmed") return "n/a";
  if (inv.paid >= inv.total) return "paid";
  if (inv.dueDate && compare(today, inv.dueDate) > 0) return "overdue";
  return inv.paid > 0 ? "partial" : "unpaid";
}

export const PAYMENT_STATE_LABEL: Record<PaymentState, string> = {
  unpaid: "未入金",
  partial: "一部入金",
  paid: "入金済み",
  overdue: "期限超過",
  "n/a": "—",
};

// ───────────────────────── B13–B15: 入金配分 ─────────────────────────

export interface AllocationRequest {
  invoiceId: string;
  amount: number;
}

export function validateAllocations(
  payment: { amount: number; allocated: number },
  requests: AllocationRequest[],
  invoices: Map<string, { status: InvoiceStatus; total: number; paid: number; companyMatch: boolean }>,
): string[] {
  const e: string[] = [];
  let sum = 0;
  const perInvoice = new Map<string, number>();
  for (const r of requests) {
    if (!Number.isInteger(r.amount) || r.amount <= 0) {
      e.push("配分額は1円以上の整数で入力してください");
      continue;
    }
    sum += r.amount;
    perInvoice.set(r.invoiceId, (perInvoice.get(r.invoiceId) ?? 0) + r.amount);
  }
  if (payment.allocated + sum > payment.amount) {
    e.push(
      `配分額の合計（${(payment.allocated + sum).toLocaleString()}円）が入金額（${payment.amount.toLocaleString()}円）を超えています`,
    );
  }
  for (const [id, amt] of perInvoice) {
    const inv = invoices.get(id);
    if (!inv || !inv.companyMatch) {
      e.push("対象の請求が見つかりません");
      continue;
    }
    if (inv.status !== "confirmed") e.push("確定済みの請求にのみ配分できます");
    const remaining = inv.total - inv.paid;
    if (amt > remaining) e.push(`請求残額（${remaining.toLocaleString()}円）を超える配分はできません`);
  }
  return e;
}

export interface MatchCandidate {
  invoiceId: string;
  score: number;
  reasons: string[];
}

/** B15: 照合候補。自動確定はしない。同点の複数候補は ambiguous=true */
export function matchCandidates(
  payment: { amount: number; payerName: string },
  invoices: { id: string; remaining: number; payerKana: string[] }[],
): { candidates: MatchCandidate[]; ambiguous: boolean } {
  const norm = (s: string) =>
    s
      .normalize("NFKC")
      .replace(/[\s　()（）]/g, "")
      .replace(/カ\)|ｶ\)|株式会社|ユ\)|有限会社/g, "")
      .toUpperCase();
  const pn = norm(payment.payerName || "");
  const candidates: MatchCandidate[] = [];
  for (const inv of invoices) {
    if (inv.remaining <= 0) continue;
    let score = 0;
    const reasons: string[] = [];
    if (inv.remaining === payment.amount) {
      score += 2;
      reasons.push("金額一致");
    }
    if (pn && inv.payerKana.some((k) => k && (norm(k) === pn || pn.includes(norm(k)) || norm(k).includes(pn)))) {
      score += 2;
      reasons.push("名義一致");
    }
    if (score > 0) candidates.push({ invoiceId: inv.id, score, reasons });
  }
  candidates.sort((a, b) => b.score - a.score);
  const top = candidates[0]?.score ?? 0;
  const ambiguous = candidates.filter((c) => c.score === top).length > 1;
  return { candidates, ambiguous };
}

// ───────────────────────── B17–B20: オーナー精算 ─────────────────────────

export interface CollectedRow {
  allocationId: string;
  itemCode: string;
  amount: number; // 回収済み額（配分額を明細へ按分済み）
}

export interface ManagementFeeSetting {
  kind: "fixed" | "rate";
  fixedAmount?: number;
  rate?: string; // "0.05"
  targetItemCodes: string[]; // 料率の対象費目（B18で明示）
  rounding: Rounding;
  taxRate: string; // 管理料にかかる消費税率
}

export interface SettlementCalc {
  collectedTotal: number;
  feeBase: number;
  fee: number;
  feeTax: number;
  expenses: number;
  carryIn: number;
  payable: number;
  carryOut: number;
  basis: string[];
}

export function computeSettlement(
  collected: CollectedRow[],
  fee: ManagementFeeSetting,
  expenses: { amount: number }[],
  carryIn: number,
): SettlementCalc {
  const collectedTotal = collected.reduce((s, r) => s + r.amount, 0);
  const feeBase = collected.filter((r) => fee.targetItemCodes.includes(r.itemCode)).reduce((s, r) => s + r.amount, 0);
  const feeAmt =
    fee.kind === "fixed" ? (fee.fixedAmount ?? 0) : roundYen(new Decimal(feeBase).mul(fee.rate ?? "0"), fee.rounding);
  const feeTax = roundYen(new Decimal(feeAmt).mul(fee.taxRate), fee.rounding);
  const exp = expenses.reduce((s, x) => s + x.amount, 0);
  const net = collectedTotal - feeAmt - feeTax - exp + carryIn;
  const payable = Math.max(net, 0);
  const carryOut = Math.min(net, 0);
  const basis = [
    `回収済み合計 ${collectedTotal.toLocaleString()}円（未回収の請求額は含まない）`,
    fee.kind === "fixed"
      ? `管理料 定額 ${feeAmt.toLocaleString()}円`
      : `管理料 ${feeBase.toLocaleString()}円（対象費目: ${fee.targetItemCodes.join("・")}）× ${new Decimal(fee.rate ?? 0).mul(100).toString()}% = ${feeAmt.toLocaleString()}円`,
    `管理料消費税 ${feeTax.toLocaleString()}円`,
    `立替費用 ${exp.toLocaleString()}円`,
    `前回繰越 ${carryIn.toLocaleString()}円`,
  ];
  return { collectedTotal, feeBase, fee: feeAmt, feeTax, expenses: exp, carryIn, payable, carryOut, basis };
}

/** B20: 共有所有者への送金配分。端数は指定先へ寄せ、合計一致を保証する */
export function splitAmongOwners(
  total: number,
  shares: { ownerId: string; ratio: string }[],
  remainderTo: string,
): { ownerId: string; amount: number }[] {
  const sumRatio = shares.reduce((s, x) => s.add(x.ratio), new Decimal(0));
  if (!sumRatio.eq(1)) throw new Error("送金配分率の合計が100%ではありません");
  if (!shares.some((s) => s.ownerId === remainderTo)) throw new Error("端数の配分先が配分対象に含まれていません");
  const rows = shares.map((s) => ({ ownerId: s.ownerId, amount: roundYen(new Decimal(total).mul(s.ratio), "floor") }));
  const diff = total - rows.reduce((s, r) => s + r.amount, 0);
  const target = rows.find((r) => r.ownerId === remainderTo)!;
  target.amount += diff;
  return rows;
}

export type SettlementStatus = "calculating" | "review" | "confirmed" | "partially_remitted" | "remitted" | "corrected";

export function deriveRemittanceStatus(payable: number, remitted: number): SettlementStatus {
  if (remitted <= 0) return "confirmed";
  if (remitted < payable) return "partially_remitted";
  return "remitted";
}

// ───────────────────────── B21: 敷金など預り金 ─────────────────────────

export interface DepositEntry {
  kind: "receive" | "apply" | "refund_planned" | "refund_executed" | "additional_charge";
  amount: number;
  approved?: boolean;
}

export function depositBalance(entries: DepositEntry[]) {
  const received = sum(entries, "receive");
  const applied = entries.filter((e) => e.kind === "apply" && e.approved !== false).reduce((s, e) => s + e.amount, 0);
  const refundPlanned = sum(entries, "refund_planned");
  const refunded = sum(entries, "refund_executed");
  const additional = sum(entries, "additional_charge");
  // 未実行の返金予定では残高を減らさない
  const balance = received - applied - refunded;
  return { received, applied, refundPlanned, refunded, additional, balance, refundPending: refundPlanned - refunded };
}

function sum(entries: DepositEntry[], kind: DepositEntry["kind"]) {
  return entries.filter((e) => e.kind === kind).reduce((s, e) => s + e.amount, 0);
}

// ───────────────────────── B22: 修繕負担 ─────────────────────────

export interface EstimateLine {
  name: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  tax: TaxSetting;
  burden: { party: "lessor" | "lessee" | "company" | "other"; amount: number }[];
}

export function validateEstimateBurden(lines: EstimateLine[], rounding: Rounding): string[] {
  const e: string[] = [];
  lines.forEach((l, i) => {
    const amt = roundYen(new Decimal(l.quantity || 0).mul(l.unitPrice || 0), rounding);
    const b = l.burden.reduce((s, x) => s + (x.amount || 0), 0);
    if (amt !== b) {
      e.push(`${i + 1}行目「${l.name || "（名称未入力）"}」: 明細金額 ${amt.toLocaleString()}円と負担額合計 ${b.toLocaleString()}円が一致しません`);
    }
  });
  return e;
}

// ───────────────────────── 状態遷移 ─────────────────────────

export const RENTAL_DEAL_STATUSES = [
  ["new", "新規"],
  ["in_progress", "対応中"],
  ["proposing", "提案中"],
  ["viewing_scheduling", "内見調整"],
  ["viewed", "内見済み"],
  ["applied", "申込"],
  ["contract_prep", "契約準備"],
  ["won", "成約"],
  ["lost", "失注"],
  ["on_hold", "保留"],
] as const;

export const SALE_DEAL_STATUSES = [
  ["consultation", "相談"],
  ["appraisal_prep", "査定準備"],
  ["mandate", "媒介受託"],
  ["marketing", "販売・紹介中"],
  ["purchase_application", "購入申込"],
  ["negotiation", "条件調整"],
  ["contracted", "契約済み"],
  ["settlement_prep", "決済準備"],
  ["delivered", "引渡完了"],
  ["closed", "失注・終了"],
] as const;

export function validateDealTransition(
  deal: { kind: "rental" | "sale"; customerId: string | null; propertyIds: string[]; contractStatus: string | null; lostReason?: string },
  to: string,
): string[] {
  const e: string[] = [];
  if (!deal.customerId) e.push("顧客が設定されていません");
  if (["viewing_scheduling", "viewed", "applied", "contract_prep", "purchase_application", "negotiation"].includes(to) && deal.propertyIds.length === 0) {
    e.push("対象物件が1件以上必要です");
  }
  if ((to === "won" || to === "contracted") && !["approved", "executed", "active"].includes(deal.contractStatus ?? "")) {
    e.push("成約には関連する契約の確定（承認済み以降）が必要です");
  }
  if ((to === "lost" || to === "closed") && !deal.lostReason) e.push("失注・終了の理由を入力してください");
  return e;
}

export const CONTRACT_STATUSES = [
  ["draft", "下書き"],
  ["in_review", "社内確認中"],
  ["approved", "承認済み"],
  ["executed", "締結記録済み"],
  ["active", "契約期間中"],
  ["ended", "終了"],
  ["cancelled", "取消"],
] as const;

export const REPAIR_STATUSES = [
  ["received", "受付"],
  ["site_check", "現地確認"],
  ["awaiting_estimate", "見積待ち"],
  ["awaiting_approval", "承認待ち"],
  ["ordered", "発注記録済み"],
  ["in_progress", "施工中"],
  ["awaiting_completion_check", "完了確認待ち"],
  ["completed", "完了"],
  ["cancelled", "中止"],
] as const;

export const MOVEOUT_STATUSES = [
  ["requested", "申出受付"],
  ["checking", "条件確認"],
  ["date_fixed", "解約日確定"],
  ["inspection_scheduled", "立会い予定"],
  ["vacated", "退去確認済み"],
  ["settlement_prep", "精算準備"],
  ["settlement_checked", "精算確認済み"],
  ["awaiting_refund", "返金・回収待ち"],
  ["completed", "完了"],
] as const;

export function labelOf(list: readonly (readonly [string, string])[], key: string | null | undefined): string {
  return list.find(([k]) => k === key)?.[1] ?? (key ?? "—");
}
