import Decimal from "decimal.js";
import { BizDate, compare, daysInMonth, inclusiveDays, parseBizDate } from "./dates";

// B11: 数量・単価は十進数で計算し、金額は円単位の整数で保持する。

export type Rounding = "floor" | "round" | "ceil";
export type ProrationMethod = "actual" | "fixed30" | "none";
export type TaxCategory = "taxable" | "exempt" | "non_taxable"; // 課税 / 非課税 / 不課税
export type PriceMode = "exclusive" | "inclusive"; // 税抜 / 税込

export function roundYen(v: Decimal.Value, mode: Rounding): number {
  const d = new Decimal(v);
  const r =
    mode === "floor"
      ? d.toDecimalPlaces(0, Decimal.ROUND_FLOOR)
      : mode === "ceil"
        ? d.toDecimalPlaces(0, Decimal.ROUND_CEIL)
        : d.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return r.toNumber();
}

export interface ProrationSetting {
  method: ProrationMethod;
  rounding: Rounding; // B08: 初期値は円未満切捨て
  /** fixed30 の日数算定。"calendar"=暦日数（上限30）, "month_end_as_30"=月末日まで含む場合は30日とみなす */
  fixed30Counting?: "calendar_cap30" | "month_end_as_30";
}

export const DEFAULT_PRORATION: ProrationSetting = { method: "actual", rounding: "floor" };

export interface ProrationResult {
  amount: number;
  days: number;
  denominator: number;
  formula: string;
}

/**
 * B07–B09: 月額のうち [from, to]（両端含む、同一月内）を日割り計算する。
 * 例: 62,000円、31日の月の16日開始 → 16/31 × 62,000 = 32,000円
 */
export function prorate(monthly: number, from: BizDate, to: BizDate, setting: ProrationSetting): ProrationResult {
  const a = parseBizDate(from);
  const b = parseBizDate(to);
  if (a.y !== b.y || a.m !== b.m) throw new Error("日割りは同一月内の期間で指定してください");
  if (compare(from, to) > 0) throw new Error("日割りの開始日が終了日より後です");
  const dim = daysInMonth(a.y, a.m);
  const days = inclusiveDays(from, to);
  const fullMonth = a.day === 1 && b.day === dim;

  if (setting.method === "none" || fullMonth) {
    return { amount: monthly, days, denominator: days, formula: `月額 ${monthly.toLocaleString()}円（日割りなし）` };
  }
  if (setting.method === "actual") {
    const amount = roundYen(new Decimal(monthly).mul(days).div(dim), setting.rounding);
    return {
      amount,
      days,
      denominator: dim,
      formula: `${days}日 ÷ ${dim}日 × ${monthly.toLocaleString()}円 = ${amount.toLocaleString()}円`,
    };
  }
  // fixed30
  let d = days;
  if (setting.fixed30Counting === "month_end_as_30" && b.day === dim) {
    d = 30 - (a.day - 1);
    if (d < 1) d = 1;
  }
  d = Math.min(d, 30);
  const amount = roundYen(new Decimal(monthly).mul(d).div(30), setting.rounding);
  return {
    amount,
    days: d,
    denominator: 30,
    formula: `${d}日 ÷ 30日 × ${monthly.toLocaleString()}円 = ${amount.toLocaleString()}円`,
  };
}

export interface TaxSetting {
  category: TaxCategory;
  rate: string; // "0.10" など。十進文字列
  priceMode: PriceMode;
}

export interface LineInput {
  quantity: string; // 十進文字列
  unitPrice: string; // 十進文字列（円）
  tax: TaxSetting;
}

export interface LineAmount {
  /** 数量×単価（設定された税込/税抜のまま）を円に丸めたもの */
  amount: number;
}

export function lineAmount(line: LineInput, rounding: Rounding): number {
  return roundYen(new Decimal(line.quantity).mul(line.unitPrice), rounding);
}

export interface TaxBreakdownRow {
  key: string; // category:rate:mode
  category: TaxCategory;
  rate: string;
  base: number; // 税抜対象額
  tax: number;
  total: number; // 税込
}

export interface InvoiceTotals {
  subtotalExclTax: number;
  tax: number;
  total: number;
  breakdown: TaxBreakdownRow[];
}

/**
 * B11: 税率別に金額を集計してから税を計算する（明細ごとの端数を積み上げない）。
 * 非課税・不課税は税0。
 */
export function computeTotals(
  lines: { amount: number; tax: TaxSetting }[],
  taxRounding: Rounding,
): InvoiceTotals {
  const groups = new Map<string, { category: TaxCategory; rate: string; excl: Decimal; incl: Decimal }>();
  for (const l of lines) {
    const rate = l.tax.category === "taxable" ? new Decimal(l.tax.rate).toString() : "0";
    const key = `${l.tax.category}:${rate}`;
    const g = groups.get(key) ?? { category: l.tax.category, rate, excl: new Decimal(0), incl: new Decimal(0) };
    if (l.tax.category === "taxable" && l.tax.priceMode === "inclusive") g.incl = g.incl.add(l.amount);
    else g.excl = g.excl.add(l.amount);
    groups.set(key, g);
  }
  const breakdown: TaxBreakdownRow[] = [];
  for (const [key, g] of groups) {
    if (g.category !== "taxable") {
      const base = g.excl.add(g.incl).toNumber();
      breakdown.push({ key, category: g.category, rate: "0", base, tax: 0, total: base });
      continue;
    }
    const r = new Decimal(g.rate);
    const taxOnExcl = roundYen(g.excl.mul(r), taxRounding);
    const taxInIncl = roundYen(g.incl.mul(r).div(r.add(1)), taxRounding);
    const base = g.excl.toNumber() + (g.incl.toNumber() - taxInIncl);
    const tax = taxOnExcl + taxInIncl;
    breakdown.push({ key, category: g.category, rate: g.rate, base, tax, total: base + tax });
  }
  breakdown.sort((a, b) => a.key.localeCompare(b.key));
  const subtotalExclTax = breakdown.reduce((s, r) => s + r.base, 0);
  const tax = breakdown.reduce((s, r) => s + r.tax, 0);
  return { subtotalExclTax, tax, total: subtotalExclTax + tax, breakdown };
}

export function yen(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `¥${n.toLocaleString("ja-JP")}`;
}
