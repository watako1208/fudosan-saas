// 契約・更新・退去の純粋な計算（サーバー・画面の両方で使用）。Firestore には依存しない。
import { BizDate, addDays, addMonths, compare, deadlineFrom, isValidBizDate, monthEnd, monthStart } from "./dates";
import { DEFAULT_PRORATION, prorate, ProrationResult } from "./money";
import { MonthlyItem, depositBalance, DepositEntry, validateContractConfirm } from "./rules";

// ───────────── 契約確定時の検証（B03） ─────────────

export interface LeaseConfirmInput {
  parties: { role: string }[];
  unitId: string | null;
  leaseType: "ordinary" | "fixed_term" | null;
  start: BizDate | null;
  end: BizDate | null;
  monthlyItems: { code: string; amount: number | null }[];
  documentsChecked: boolean;
  depositAmount: number | null;
  depositHolder: string | null;
}

/** 賃貸契約の確定前検証。共通ルール validateContractConfirm に賃貸固有の確認を加える */
export function leaseConfirmErrors(v: LeaseConfirmInput): string[] {
  const e = validateContractConfirm({
    partyCount: {
      lessor: v.parties.filter((p) => p.role === "lessor").length,
      lessee: v.parties.filter((p) => p.role === "lessee").length,
    },
    unitId: v.unitId,
    start: v.start,
    end: v.end,
    monthlyItems: v.monthlyItems.map((m) => ({ code: m.code, amount: m.amount ?? 0 })),
    requiredItemCodes: [],
    documentsChecked: v.documentsChecked,
  });
  if (!v.leaseType) e.push("契約種別（普通借家・定期借家）が選択されていません");
  if (v.leaseType === "fixed_term" && !v.end) e.push("定期借家契約は契約終了日が必須です");
  if (v.monthlyItems.length === 0) e.push("月額費用が1件も設定されていません");
  v.monthlyItems.forEach((m, i) => {
    if (m.amount === null || m.amount === undefined) e.push(`月額費用 ${i + 1}行目の金額が入力されていません`);
  });
  if (v.depositAmount !== null && v.depositAmount > 0 && !v.depositHolder) e.push("敷金の保管主体（自社・貸主など）が選択されていません");
  return e;
}

export interface SaleConfirmInput {
  parties: { role: string }[];
  propertyIds: string[];
  salePrice: number | null;
  earnestMoney: number | null;
  balanceAmount: number | null;
  contractDate: BizDate | null;
  settlementDate: BizDate | null;
  deliveryDate: BizDate | null;
  documentsChecked: boolean;
}

export function saleConfirmErrors(v: SaleConfirmInput): string[] {
  const e: string[] = [];
  if (!v.parties.some((p) => p.role === "seller")) e.push("売主が登録されていません");
  if (!v.parties.some((p) => p.role === "buyer")) e.push("買主が登録されていません");
  if (v.propertyIds.length === 0) e.push("対象の土地・建物が選択されていません");
  if (v.salePrice === null) e.push("売買代金が入力されていません");
  if (!v.contractDate) e.push("契約日が入力されていません");
  if (!v.settlementDate) e.push("決済予定日が入力されていません");
  if (v.contractDate && v.settlementDate && compare(v.contractDate, v.settlementDate) > 0) e.push("決済予定日が契約日より前です");
  if (v.contractDate && v.deliveryDate && compare(v.contractDate, v.deliveryDate) > 0) e.push("引渡日が契約日より前です");
  if (v.salePrice !== null && v.earnestMoney !== null && v.balanceAmount !== null && v.earnestMoney + v.balanceAmount !== v.salePrice) {
    e.push(
      `手付金（${v.earnestMoney.toLocaleString()}円）と残代金（${v.balanceAmount.toLocaleString()}円）の合計が売買代金（${v.salePrice.toLocaleString()}円）と一致しません`,
    );
  }
  if (!v.documentsChecked) e.push("契約書類の確認が完了していません");
  return e;
}

// ───────────── 日割りの確認表示（B07–B09） ─────────────

export interface ProrationPreviewRow {
  code: string;
  name: string;
  monthly: number;
  from: BizDate;
  to: BizDate;
  result: ProrationResult | null;
  error: string | null;
}

/** 開始月の日割り（開始日〜月末。終了日が同月内ならそこまで） */
export function firstMonthProration(items: { code: string; name: string; amount: number | null; proration?: MonthlyItem["proration"] }[], start: BizDate, end: BizDate | null = null): ProrationPreviewRow[] {
  if (!isValidBizDate(start)) return [];
  const me = monthEnd(start.slice(0, 7));
  const to = end && isValidBizDate(end) && compare(end, me) < 0 ? end : me;
  return items.map((it) => {
    const base = { code: it.code, name: it.name, monthly: it.amount ?? 0, from: start, to };
    if (it.amount === null || it.amount === undefined) return { ...base, result: null, error: "金額未入力" };
    try {
      return { ...base, result: prorate(it.amount, start, to, it.proration ?? DEFAULT_PRORATION), error: null };
    } catch (err) {
      return { ...base, result: null, error: (err as Error).message };
    }
  });
}

// ───────────── 契約版の適用期間（B05） ─────────────

export function validateChangeEffectiveFrom(currentFrom: BizDate, newFrom: BizDate | null, contractEnd: BizDate | null): string[] {
  const e: string[] = [];
  if (!newFrom || !isValidBizDate(newFrom)) {
    e.push("変更開始日を入力してください");
    return e;
  }
  if (compare(newFrom, currentFrom) <= 0) e.push(`変更開始日は現在の版の適用開始日（${currentFrom}）より後の日付にしてください`);
  if (contractEnd && compare(newFrom, contractEnd) > 0) e.push(`変更開始日が契約終了日（${contractEnd}）より後です`);
  return e;
}

/** 新しい版の適用開始日から、前の版の適用終了日（前日）を求める */
export function previousEffectiveTo(newFrom: BizDate): BizDate {
  return addDays(newFrom, -1);
}

export interface VersionRange {
  id: string;
  versionNo: number;
  status: "draft" | "confirmed";
  effectiveFrom: BizDate;
  effectiveTo: BizDate | null;
}

/** 指定日に適用される確定済みの版 */
export function versionAt<T extends VersionRange>(versions: T[], date: BizDate): T | null {
  const hits = versions
    .filter((v) => v.status === "confirmed" && compare(v.effectiveFrom, date) <= 0 && (!v.effectiveTo || compare(date, v.effectiveTo) <= 0))
    .sort((a, b) => b.versionNo - a.versionNo);
  return hits[0] ?? null;
}

/** 確定済みの版同士で適用期間が重なっていないか（検証用） */
export function versionRangeErrors(versions: VersionRange[]): string[] {
  const c = versions.filter((v) => v.status === "confirmed").sort((a, b) => a.versionNo - b.versionNo);
  const e: string[] = [];
  for (let i = 1; i < c.length; i++) {
    const prev = c[i - 1];
    const cur = c[i];
    if (!prev.effectiveTo) e.push(`第${prev.versionNo}版の適用終了日が設定されていません`);
    else if (addDays(prev.effectiveTo, 1) !== cur.effectiveFrom) e.push(`第${prev.versionNo}版と第${cur.versionNo}版の適用期間が連続していません`);
  }
  return e;
}

export interface AmountTerms {
  monthlyItems: { code: string; name: string; amount: number | null }[];
  initialItems?: { code: string; name: string; amount: number | null }[];
  depositAmount?: number | null;
  salePrice?: number | null;
  earnestMoney?: number | null;
  balanceAmount?: number | null;
  renewal?: { fee: number | null; termMonths: number | null } | null;
  end?: BizDate | null;
}

export interface DiffRow {
  label: string;
  before: number | string | null;
  after: number | string | null;
  delta: number | null;
}

/** 版の金額差分（版履歴の表示用）。変化のない項目は含めない */
export function versionAmountDiff(prev: AmountTerms | null, next: AmountTerms): DiffRow[] {
  const rows: DiffRow[] = [];
  const num = (label: string, a: number | null | undefined, b: number | null | undefined) => {
    const x = a ?? null;
    const y = b ?? null;
    if (x === y) return;
    rows.push({ label, before: x, after: y, delta: x !== null && y !== null ? y - x : null });
  };
  const codes = new Map<string, string>();
  for (const m of [...(prev?.monthlyItems ?? []), ...next.monthlyItems]) if (!codes.has(m.code)) codes.set(m.code, m.name);
  for (const [code, name] of codes) {
    num(`月額: ${name}`, prev?.monthlyItems.find((m) => m.code === code)?.amount, next.monthlyItems.find((m) => m.code === code)?.amount);
  }
  const icodes = new Map<string, string>();
  for (const m of [...(prev?.initialItems ?? []), ...(next.initialItems ?? [])]) if (!icodes.has(m.code)) icodes.set(m.code, m.name);
  for (const [code, name] of icodes) {
    num(`初期: ${name}`, prev?.initialItems?.find((m) => m.code === code)?.amount, next.initialItems?.find((m) => m.code === code)?.amount);
  }
  num("敷金", prev?.depositAmount, next.depositAmount);
  num("更新料", prev?.renewal?.fee, next.renewal?.fee);
  num("売買代金", prev?.salePrice, next.salePrice);
  num("手付金", prev?.earnestMoney, next.earnestMoney);
  num("残代金", prev?.balanceAmount, next.balanceAmount);
  if ((prev?.end ?? null) !== (next.end ?? null)) rows.push({ label: "契約終了日", before: prev?.end ?? null, after: next.end ?? null, delta: null });
  return rows;
}

// ───────────── 更新（S21 / B24） ─────────────

export function renewalSourceKey(contractId: string, end: BizDate): string {
  return `${contractId}__${end}`;
}

/** 更新案内期限: 契約版に保存された期限ルールから計算する（会社設定は参照しない） */
export function noticeDeadlineFromRule(
  end: BizDate,
  rule: { base: "contract_end" | "custom"; unit: "days" | "months"; amount: number; holidayAdjust: "none" | "previous_weekday" } | null | undefined,
): BizDate | null {
  if (!rule || rule.base !== "contract_end" || !Number.isFinite(rule.amount)) return null;
  return deadlineFrom(end, rule);
}

export function isRenewalTarget(c: { kind: string; status: string; end: BizDate | null }, today: BizDate, horizonDays: number): boolean {
  if (c.kind !== "lease" || !c.end) return false;
  if (!["executed", "active"].includes(c.status)) return false;
  return compare(c.end, today) >= 0 && compare(c.end, addDays(today, horizonDays)) <= 0;
}

/** 更新後の期間: 旧終了日の翌日から termMonths か月（両端含む） */
export function renewedPeriod(end: BizDate, termMonths: number): { effectiveFrom: BizDate; newEnd: BizDate } {
  const effectiveFrom = addDays(end, 1);
  return { effectiveFrom, newEnd: addDays(addMonths(effectiveFrom, termMonths), -1) };
}

// ───────────── 解約・退去（S22） ─────────────

/** 解約予告ルールによる最短解約日（申出日から n 日・n か月後） */
export function earliestTerminationDate(requestedAt: BizDate, rule: { unit: "days" | "months"; amount: number } | null | undefined): BizDate | null {
  if (!rule || !isValidBizDate(requestedAt)) return null;
  return rule.unit === "days" ? addDays(requestedAt, rule.amount) : addMonths(requestedAt, rule.amount);
}

export interface ImpactInvoice {
  id: string;
  number: string;
  kind: string;
  period: string | null;
  status: string;
  total: number;
}

export interface MoveoutImpact {
  endBefore: BizDate | null;
  endAfter: BizDate;
  finalPeriod: string;
  finalMonth: ProrationPreviewRow[];
  affectedInvoices: ImpactInvoice[];
}

/**
 * 解約日を変更した場合の影響（表示のみ。請求は変更しない）
 * - 契約終了日の変更
 * - 最終月の月額費用の日割り（版の計算設定どおり）
 * - 最終月以降の既存請求（取消済みを除く）
 */
export function moveoutImpact(input: {
  confirmedDate: BizDate;
  contractStart: BizDate | null;
  contractEnd: BizDate | null;
  versionFrom: BizDate | null;
  monthlyItems: MonthlyItem[];
  invoices: ImpactInvoice[];
}): MoveoutImpact | null {
  const d = input.confirmedDate;
  if (!isValidBizDate(d)) return null;
  const period = d.slice(0, 7);
  let from = monthStart(period);
  for (const x of [input.contractStart, input.versionFrom]) if (x && isValidBizDate(x) && compare(x, from) > 0) from = x;
  const finalMonth: ProrationPreviewRow[] =
    compare(from, d) > 0
      ? []
      : input.monthlyItems.map((it) => {
          const base = { code: it.code, name: it.name, monthly: it.amount, from, to: d };
          try {
            return { ...base, result: prorate(it.amount, from, d, it.proration ?? DEFAULT_PRORATION), error: null };
          } catch (err) {
            return { ...base, result: null, error: (err as Error).message };
          }
        });
  const affectedInvoices = input.invoices
    .filter((i) => i.status !== "cancelled" && i.period !== null && i.period >= period)
    .sort((a, b) => ((a.period ?? "") < (b.period ?? "") ? -1 : 1));
  return { endBefore: input.contractEnd, endAfter: d, finalPeriod: period, finalMonth, affectedInvoices };
}

// ───────────── 敷金など預り金（B21 / T12） ─────────────

export type DepositHolder = "company" | "lessor" | "other";

export interface HolderEntry extends DepositEntry {
  holder: DepositHolder;
}

/** 保管主体ごとの残高。貸主保管分を自社の現金残高に合算しない */
export function depositByHolder(entries: HolderEntry[]) {
  const holders: DepositHolder[] = ["company", "lessor", "other"];
  const out = {} as Record<DepositHolder, ReturnType<typeof depositBalance>>;
  for (const h of holders) out[h] = depositBalance(entries.filter((e) => e.holder === h));
  return out;
}

/** 充当・返金実行で残高がマイナスにならないか */
export function depositEntryErrors(
  existing: HolderEntry[],
  entry: { kind: DepositEntry["kind"]; amount: number; holder: DepositHolder },
): string[] {
  const e: string[] = [];
  if (!Number.isInteger(entry.amount) || entry.amount <= 0) e.push("金額は1円以上の整数で入力してください");
  if (entry.kind === "apply" || entry.kind === "refund_executed") {
    // 未承認の充当も保守的に差し引いて判定する
    const b = depositBalance(existing.filter((x) => x.holder === entry.holder).map((x) => ({ ...x, approved: true })));
    if (entry.amount > b.balance) {
      e.push(`預り残高（${b.balance.toLocaleString()}円）を超えています。不足分は「追加請求」として記録してください`);
    }
  }
  return e;
}
