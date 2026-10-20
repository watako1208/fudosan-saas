import Decimal from "decimal.js";
import { BizDate, daysInMonth, fmt, monthEnd, monthStart, periodsOverlap } from "./dates";
import { Rounding, TaxSetting, computeTotals, lineAmount } from "./money";
import { CollectedRow, ManagementFeeSetting, PlannedCharge, computeSettlement, PaymentState } from "./rules";

// 請求・入金・精算モジュールの純粋関数（Firestore に依存しない。vitest で検証する）。

// ───────────── 期間 ─────────────

export const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isValidPeriod(p: unknown): p is string {
  return typeof p === "string" && PERIOD_RE.test(p);
}

export function periodOf(date: BizDate): string {
  return date.slice(0, 7);
}

export function addPeriod(period: string, n: number): string {
  const [y, m] = period.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

/** ISO日時 → 日本日付 */
export function isoToJstDate(iso: string): BizDate {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/** B25: 締め済みか（closedThrough 以前、または個別の締めレコードあり） */
export function isPeriodLocked(period: string, closedThrough: string | null | undefined, lockedPeriods: Iterable<string> = []): boolean {
  if (closedThrough && period <= closedThrough) return true;
  for (const p of lockedPeriods) if (p === period) return true;
  return false;
}

// ───────────── 請求 ─────────────

/**
 * 支払期日: 前月払い（prev_month）は対象月の前月、当月払いは対象月の paymentDueDay 日。
 * 月の日数を超える指定（31日など）は月末に寄せる。未設定は月末。
 */
export function dueDateFor(period: string, dueDay: number | null | undefined, timing: "prev_month" | "current_month"): BizDate {
  const p = timing === "prev_month" ? addPeriod(period, -1) : period;
  const [y, m] = p.split("-").map(Number);
  const dim = daysInMonth(y, m);
  const d = dueDay && dueDay > 0 ? Math.min(dueDay, dim) : dim;
  return fmt(y, m, d);
}

/** 請求の入金状況（保存用の集約値）。期限超過は表示時に日付から判定する */
export type PaidState = "none" | "partial" | "full";

export function paidStateOf(total: number, paid: number): PaidState {
  if (paid >= total) return "full";
  return paid > 0 ? "partial" : "none";
}

/** 一覧の絞込み（入金状態）を Firestore 条件に変換する。derivePaymentState と同じ判定 */
export function paymentStateWhere(state: PaymentState, today: BizDate): [string, "==" | "in" | "<" | ">=", unknown][] | null {
  switch (state) {
    case "paid":
      return [["status", "==", "confirmed"], ["paidState", "==", "full"]];
    case "unpaid":
      return [["status", "==", "confirmed"], ["paidState", "==", "none"], ["dueDate", ">=", today]];
    case "partial":
      return [["status", "==", "confirmed"], ["paidState", "==", "partial"], ["dueDate", ">=", today]];
    case "overdue":
      return [["status", "==", "confirmed"], ["paidState", "in", ["none", "partial"]], ["dueDate", "<", today]];
    default:
      return null;
  }
}

export interface LineDraft {
  itemCode: string;
  name: string;
  quantity: string;
  unitPrice: string;
  tax: TaxSetting;
}

const DEC_RE = /^-?\d+(\.\d+)?$/;

/** 手入力の明細を検証し金額を計算する（数量・単価は十進数） */
export function buildLines(drafts: LineDraft[], rounding: Rounding, opts: { allowNegative?: boolean } = {}): { lines: (LineDraft & { amount: number })[]; errors: string[] } {
  const errors: string[] = [];
  const lines: (LineDraft & { amount: number })[] = [];
  drafts.forEach((d, i) => {
    const n = i + 1;
    const q = (d.quantity ?? "").normalize("NFKC").replace(/,/g, "").trim();
    const u = (d.unitPrice ?? "").normalize("NFKC").replace(/[,¥円]/g, "").trim();
    if (!d.itemCode) errors.push(`${n}行目: 費目を選択してください`);
    if (!d.name?.trim()) errors.push(`${n}行目: 名称を入力してください`);
    if (!DEC_RE.test(q)) errors.push(`${n}行目: 数量は数値で入力してください`);
    if (!DEC_RE.test(u)) errors.push(`${n}行目: 単価は数値で入力してください`);
    if (!DEC_RE.test(q) || !DEC_RE.test(u)) return;
    if (!opts.allowNegative && (new Decimal(q).lt(0) || new Decimal(u).lt(0))) errors.push(`${n}行目: マイナスの数量・単価は訂正（差額調整）で入力してください`);
    if (d.tax.category === "taxable" && !DEC_RE.test(d.tax.rate)) errors.push(`${n}行目: 税率が正しくありません`);
    const tax: TaxSetting = d.tax.category === "taxable" ? d.tax : { category: d.tax.category, rate: "0", priceMode: "exclusive" };
    lines.push({ itemCode: d.itemCode, name: d.name.trim(), quantity: q, unitPrice: u, tax, amount: lineAmount({ quantity: q, unitPrice: u, tax }, rounding) });
  });
  return { lines, errors };
}

/** 請求合計（B11: 税率別に集計してから税計算） */
export function invoiceTotals(lines: { amount: number; tax: TaxSetting }[], taxRounding: Rounding) {
  const t = computeTotals(lines, taxRounding);
  return { subtotal: t.subtotalExclTax, tax: t.tax, total: t.total, breakdown: t.breakdown };
}

/**
 * B16: 訂正後の明細と元の明細の差額明細を作る（費目＋名称単位）。差がない費目は出さない。
 * 差額は数量1・単価=差額で表し、元請求の税設定を引き継ぐ。
 */
export function differenceLines<T extends { itemCode: string; name: string; amount: number; tax: TaxSetting }>(
  original: T[],
  corrected: T[],
): { itemCode: string; name: string; amount: number; tax: TaxSetting; before: number; after: number }[] {
  const key = (l: T) => `${l.itemCode}\u0000${l.name}\u0000${l.tax.category}:${l.tax.rate}:${l.tax.priceMode}`;
  const map = new Map<string, { itemCode: string; name: string; tax: TaxSetting; before: number; after: number }>();
  for (const l of original) {
    const k = key(l);
    const g = map.get(k) ?? { itemCode: l.itemCode, name: l.name, tax: l.tax, before: 0, after: 0 };
    g.before += l.amount;
    map.set(k, g);
  }
  for (const l of corrected) {
    const k = key(l);
    const g = map.get(k) ?? { itemCode: l.itemCode, name: l.name, tax: l.tax, before: 0, after: 0 };
    g.after += l.amount;
    map.set(k, g);
  }
  return [...map.values()].filter((g) => g.after !== g.before).map((g) => ({ ...g, amount: g.after - g.before }));
}

/**
 * B05: 下書き請求の明細と、現在の契約版から計画した明細を比較し、再計算が必要か判定する。
 * 自動作成された明細（dedupeKey あり）のみ比較する。
 */
export function recalcDiff(
  lines: { dedupeKey: string | null; amount: number; contractVersionId: string | null }[],
  planned: Pick<PlannedCharge, "dedupeKey" | "amount" | "versionId">[],
): { changed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const auto = lines.filter((l) => l.dedupeKey);
  const cur = new Map(auto.map((l) => [l.dedupeKey!, l]));
  const plan = new Map(planned.map((p) => [p.dedupeKey, p]));
  for (const [k, l] of cur) {
    const p = plan.get(k);
    if (!p) reasons.push(`費目「${itemOfKey(k)}」は現在の契約条件では請求対象外です`);
    else {
      if (p.versionId !== l.contractVersionId) reasons.push(`費目「${itemOfKey(k)}」の契約版が変更されています`);
      if (p.amount !== l.amount) reasons.push(`費目「${itemOfKey(k)}」の金額が ${l.amount.toLocaleString()}円 → ${p.amount.toLocaleString()}円 に変わります`);
    }
  }
  for (const [k] of plan) if (!cur.has(k)) reasons.push(`費目「${itemOfKey(k)}」が新たに請求対象になります`);
  return { changed: reasons.length > 0, reasons };
}

function itemOfKey(k: string): string {
  return k.split("__")[2] ?? k;
}

// ───────────── 入金配分 ─────────────

/**
 * 配分額を請求明細へ按分する（精算の費目別集計に使う）。
 * 明細金額の比率で切捨て按分し、端数は最も金額の大きい明細へ寄せる。合計は必ず配分額に一致する。
 * マイナス明細（値引き等）は按分の重みに含めない。同じ費目は合算する。
 */
export function splitAllocationByLines(amount: number, lines: { itemCode: string; amount: number }[]): { itemCode: string; amount: number }[] {
  const pos = lines.filter((l) => l.amount > 0);
  if (amount === 0) return [];
  if (pos.length === 0) return lines.length ? [{ itemCode: lines[0].itemCode, amount }] : [{ itemCode: "unknown", amount }];
  const weight = pos.reduce((s, l) => s + l.amount, 0);
  const parts = pos.map((l) => ({ itemCode: l.itemCode, src: l.amount, amount: new Decimal(amount).mul(l.amount).div(weight).floor().toNumber() }));
  const diff = amount - parts.reduce((s, p) => s + p.amount, 0);
  let maxIdx = 0;
  parts.forEach((p, i) => {
    if (p.src > parts[maxIdx].src) maxIdx = i;
  });
  parts[maxIdx].amount += diff;
  const merged = new Map<string, number>();
  for (const p of parts) merged.set(p.itemCode, (merged.get(p.itemCode) ?? 0) + p.amount);
  return [...merged.entries()].map(([itemCode, amount]) => ({ itemCode, amount })).filter((x) => x.amount !== 0);
}

/** 入金の配分可能額（返金指定分は配分できない） */
export function allocatableOf(p: { amount: number; allocated: number; unallocatedDisposition: null | { kind: "carry_forward" | "refund"; amount: number } }): number {
  const refund = p.unallocatedDisposition?.kind === "refund" ? p.unallocatedDisposition.amount : 0;
  return p.amount - refund - p.allocated;
}

export function paymentStatusOf(p: { amount: number; allocated: number; unallocatedDisposition: null | { kind: "carry_forward" | "refund"; amount: number } }): "unallocated" | "partial" | "allocated" {
  if (allocatableOf(p) <= 0) return "allocated";
  return p.allocated > 0 ? "partial" : "unallocated";
}

/** 配分の入力を請求ごとに合算する（同じ請求を複数行で指定しても1件として扱う） */
export function mergeAllocationRequests(reqs: { invoiceId: string; amount: number }[]): { invoiceId: string; amount: number }[] {
  const m = new Map<string, number>();
  for (const r of reqs) m.set(r.invoiceId, (m.get(r.invoiceId) ?? 0) + r.amount);
  return [...m.entries()].map(([invoiceId, amount]) => ({ invoiceId, amount }));
}

// ───────────── CSV取込み ─────────────

/**
 * 重複候補: 他の取込み・手入力の既存入金と内容が一致する行、同じファイル内で内容が一致する行。
 * 候補は表示するだけで削除しない（同日同額の正当な入金があり得る）。
 */
export function duplicateCandidates(
  rows: { rowNo: number; fingerprint: string | null }[],
  existing: { id: string; fingerprint: string; importBatchId: string | null }[],
  batchId: string,
): Map<number, { otherIds: string[]; sameFileRows: number[] }> {
  const out = new Map<number, { otherIds: string[]; sameFileRows: number[] }>();
  const byFp = new Map<string, number[]>();
  for (const r of rows) if (r.fingerprint) byFp.set(r.fingerprint, [...(byFp.get(r.fingerprint) ?? []), r.rowNo]);
  for (const r of rows) {
    if (!r.fingerprint) continue;
    const otherIds = existing.filter((e) => e.fingerprint === r.fingerprint && e.importBatchId !== batchId).map((e) => e.id);
    const sameFileRows = (byFp.get(r.fingerprint) ?? []).filter((n) => n !== r.rowNo);
    if (otherIds.length || sameFileRows.length) out.set(r.rowNo, { otherIds, sameFileRows });
  }
  return out;
}

/** 列名から列対応を推測する（担当者が確認・変更する） */
export function guessPaymentMapping(headers: string[]): { date?: number; amount?: number; payer?: number; reference?: number; account?: number } {
  const find = (re: RegExp) => {
    const i = headers.findIndex((h) => re.test(h.normalize("NFKC")));
    return i >= 0 ? i : undefined;
  };
  return {
    date: find(/入金日|取引日|日付|年月日|date/i),
    amount: find(/入金額|金額|お預り|預入|amount/i),
    payer: find(/名義|振込依頼人|依頼人|摘要|payer|name/i),
    reference: find(/参照|照会|番号|reference|ref/i),
    account: find(/口座|account/i),
  };
}

// ───────────── オーナー精算 ─────────────

export interface AllocationForSettlement {
  id: string;
  propertyId: string | null;
  reversed: boolean;
  settlementId: string | null;
  paymentDate?: string | null;
  allocatedAt: string;
  amount: number;
  itemBreakdown: { itemCode: string; amount: number }[];
}

/** 入金日（配分時に保存。古いデータは配分日時の日本日付） */
export function paymentDateOf(a: Pick<AllocationForSettlement, "paymentDate" | "allocatedAt">): BizDate {
  return a.paymentDate ?? isoToJstDate(a.allocatedAt);
}

/**
 * B17/B19: 精算対象の配分 = 対象物件の、入金日が対象月末以前で、取消されておらず、まだどの精算にも含まれていないもの。
 * （請求しただけの未回収額は配分が存在しないため含まれない。過去月の未精算分も取りこぼさない）
 */
export function selectSettlementAllocations<T extends AllocationForSettlement>(allocs: T[], propertyIds: string[], period: string): T[] {
  const props = new Set(propertyIds);
  const end = monthEnd(period);
  return allocs.filter((a) => !a.reversed && !a.settlementId && a.propertyId && props.has(a.propertyId) && paymentDateOf(a) <= end);
}

/** 配分の費目別按分を精算行にする。預り金（敷金など）はオーナー収入から除外する */
export function collectedRowsOf(allocs: AllocationForSettlement[], depositCodes: Set<string>): { rows: (CollectedRow & { propertyId: string })[]; depositTotal: number } {
  const rows: (CollectedRow & { propertyId: string })[] = [];
  let depositTotal = 0;
  for (const a of allocs) {
    const parts = a.itemBreakdown?.length ? a.itemBreakdown : [{ itemCode: "unknown", amount: a.amount }];
    for (const p of parts) {
      if (depositCodes.has(p.itemCode)) depositTotal += p.amount;
      else rows.push({ allocationId: a.id, itemCode: p.itemCode, amount: p.amount, propertyId: a.propertyId ?? "" });
    }
  }
  return { rows, depositTotal };
}

export interface PropertyFeeGroup {
  propertyId: string;
  label: string;
  fee: ManagementFeeSetting | null;
}

/** 物件ごとに管理料を計算して合算する（B18: 計算根拠を残す） */
export function computeOwnerSettlement(
  rows: (CollectedRow & { propertyId: string })[],
  groups: PropertyFeeGroup[],
  expenses: { amount: number }[],
  carryIn: number,
  depositTotal = 0,
) {
  const NO_FEE: ManagementFeeSetting = { kind: "fixed", fixedAmount: 0, targetItemCodes: [], rounding: "floor", taxRate: "0" };
  let collectedTotal = 0;
  let feeBase = 0;
  let fee = 0;
  let feeTax = 0;
  const basis: string[] = [];
  for (const g of groups) {
    const r = computeSettlement(rows.filter((x) => x.propertyId === g.propertyId), g.fee ?? NO_FEE, [], 0);
    collectedTotal += r.collectedTotal;
    feeBase += r.feeBase;
    fee += r.fee;
    feeTax += r.feeTax;
    basis.push(`【${g.label}】回収済み ${r.collectedTotal.toLocaleString()}円`);
    if (g.fee) basis.push(`【${g.label}】${r.basis[1]}／消費税 ${r.feeTax.toLocaleString()}円`);
    else basis.push(`【${g.label}】管理料設定なし（0円）`);
  }
  const exp = expenses.reduce((s, x) => s + x.amount, 0);
  const net = collectedTotal - fee - feeTax - exp + carryIn;
  const payable = Math.max(net, 0);
  const carryOut = Math.min(net, 0);
  basis.unshift(`回収済み合計 ${collectedTotal.toLocaleString()}円（入金配分済みの額のみ。未回収の請求額は含まない）`);
  if (depositTotal) basis.push(`預り金（敷金など）${depositTotal.toLocaleString()}円は家賃収入と区別し、精算額に含めない`);
  basis.push(`立替費用 ${exp.toLocaleString()}円`, `前回繰越 ${carryIn.toLocaleString()}円`);
  basis.push(net < 0 ? `差引 ${net.toLocaleString()}円（送金なし・次回へ繰越）` : `送金予定額 ${payable.toLocaleString()}円`);
  return { collectedTotal, feeBase, fee, feeTax, expenses: exp, carryIn, payable, carryOut, basis };
}

/** 持分 "1/2" / "0.5" / "50%" → 十進文字列 */
export function ratioToDecimal(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.normalize("NFKC").trim();
  const frac = /^(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (frac) return Number(frac[2]) === 0 ? null : new Decimal(frac[1]).div(frac[2]).toString();
  const pct = /^(\d+(\.\d+)?)%$/.exec(t);
  if (pct) return new Decimal(pct[1]).div(100).toString();
  if (DEC_RE.test(t)) return new Decimal(t).toString();
  return null;
}

/** 所有関係が対象月に有効か（両端含む） */
export function ownershipActiveIn(o: { from: string; to: string | null }, period: string): boolean {
  return periodsOverlap({ start: o.from, end: o.to }, { start: monthStart(period), end: monthEnd(period) });
}
