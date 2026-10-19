import { describe, expect, it } from "vitest";
import { prorate, computeTotals } from "./money";
import {
  findOverlappingContracts,
  planMonthlyCharges,
  splitNewAndExisting,
  validateAllocations,
  matchCandidates,
  computeSettlement,
  splitAmongOwners,
  depositBalance,
  validateEstimateBurden,
  derivePaymentState,
  validateDealTransition,
  ContractVersionForBilling,
} from "./rules";
import { safeCell, normalizePaymentRow, detectEncoding, decodeCsv } from "./csv";
import { deadlineFrom, periodsOverlap } from "./dates";
import iconv from "iconv-lite";

const tax10 = { category: "taxable" as const, rate: "0.10", priceMode: "exclusive" as const };
const exempt = { category: "exempt" as const, rate: "0", priceMode: "exclusive" as const };
const actual = { method: "actual" as const, rounding: "floor" as const };

describe("T04 日割り", () => {
  it("B09: 月額62,000円・31日の月の16日開始 → 32,000円", () => {
    const r = prorate(62000, "2026-10-16", "2026-10-31", actual);
    expect(r.amount).toBe(32000);
    expect(r.days).toBe(16);
    expect(r.denominator).toBe(31);
    expect(r.formula).toContain("16日 ÷ 31日");
  });
  it("月末開始は1日分", () => {
    expect(prorate(62000, "2026-10-31", "2026-10-31", actual).amount).toBe(2000);
  });
  it("2月（平年28日）", () => {
    expect(prorate(56000, "2027-02-15", "2027-02-28", actual).amount).toBe(28000);
  });
  it("うるう年2月（29日）", () => {
    expect(prorate(58000, "2028-02-15", "2028-02-29", actual).amount).toBe(30000);
  });
  it("月途中解約（開始1日〜20日）", () => {
    expect(prorate(60000, "2026-11-01", "2026-11-20", actual).amount).toBe(40000);
  });
  it("円未満は切捨て（初期値）", () => {
    expect(prorate(100000, "2026-10-01", "2026-10-10", actual).amount).toBe(32258); // 32258.06
  });
  it("30日固定方式は上限30日", () => {
    const r = prorate(60000, "2026-10-01", "2026-10-31", { method: "fixed30", rounding: "floor" });
    expect(r.amount).toBe(60000); // 全月
    const r2 = prorate(60000, "2026-10-02", "2026-10-31", { method: "fixed30", rounding: "floor" });
    expect(r2.days).toBe(30);
    expect(r2.amount).toBe(60000);
    const r3 = prorate(60000, "2026-10-16", "2026-10-31", { method: "fixed30", rounding: "floor", fixed30Counting: "month_end_as_30" });
    expect(r3.days).toBe(15);
    expect(r3.amount).toBe(30000);
  });
  it("日割りなしは月額", () => {
    expect(prorate(62000, "2026-10-16", "2026-10-31", { method: "none", rounding: "floor" }).amount).toBe(62000);
  });
});

describe("B10/B11 税", () => {
  it("税率別に集計して税を計算し、非課税は税0", () => {
    const t = computeTotals(
      [
        { amount: 80000, tax: exempt }, // 住宅家賃
        { amount: 333, tax: tax10 },
        { amount: 333, tax: tax10 },
        { amount: 11000, tax: { ...tax10, priceMode: "inclusive" } },
      ],
      "floor",
    );
    // 666*0.1=66.6→66、11000内税=1000
    expect(t.tax).toBe(66 + 1000);
    expect(t.total).toBe(80000 + 666 + 66 + 11000);
  });
});

describe("T03 契約期間の重複", () => {
  const cur = { id: "c1", unitId: "u1", status: "active", start: "2025-04-01", end: "2027-03-31" };
  it("重なる確定契約を検出", () => {
    expect(findOverlappingContracts({ unitId: "u1", start: "2027-03-31", end: null }, [cur])).toHaveLength(1);
  });
  it("終了後に始まる契約は登録可能", () => {
    expect(findOverlappingContracts({ unitId: "u1", start: "2027-04-01", end: null }, [cur])).toHaveLength(0);
  });
  it("下書きは占有に数えない", () => {
    expect(findOverlappingContracts({ unitId: "u1", start: "2026-01-01", end: null }, [{ ...cur, status: "draft" }])).toHaveLength(0);
  });
  it("両端を含む", () => {
    expect(periodsOverlap({ start: "2026-01-01", end: "2026-01-31" }, { start: "2026-01-31", end: null })).toBe(true);
  });
});

describe("T05 月額請求の再作成", () => {
  const v: ContractVersionForBilling = {
    contractId: "c1",
    versionId: "v1",
    versionNo: 1,
    effectiveFrom: "2026-10-16",
    effectiveTo: null,
    contractStart: "2026-10-16",
    contractEnd: null,
    monthlyItems: [
      { code: "rent", name: "賃料", amount: 62000, tax: exempt, proration: actual },
      { code: "common", name: "共益費", amount: 3100, tax: exempt, proration: actual },
    ],
  };
  it("2回目は新規作成0件", () => {
    const plan = planMonthlyCharges("2026-10", [v]);
    expect(plan.map((p) => p.amount)).toEqual([32000, 1600]);
    const keys = new Set(plan.map((p) => p.dedupeKey));
    expect(splitNewAndExisting(planMonthlyCharges("2026-10", [v]), keys).toCreate).toHaveLength(0);
  });
  it("版をまたぐ月は版ごとに日割りし1明細へ合算", () => {
    const v1 = { ...v, effectiveFrom: "2026-01-01", contractStart: "2026-01-01", effectiveTo: "2026-11-15" };
    const v2 = { ...v1, versionId: "v2", versionNo: 2, effectiveFrom: "2026-11-16", effectiveTo: null, monthlyItems: [{ ...v.monthlyItems[0], amount: 66000 }] };
    const plan = planMonthlyCharges("2026-11", [v1, v2]);
    const rent = plan.find((p) => p.itemCode === "rent")!;
    expect(rent.amount).toBe(31000 + 33000);
    expect(plan.filter((p) => p.itemCode === "rent")).toHaveLength(1);
  });
});

describe("T06/T07 入金配分", () => {
  const invs = new Map([
    ["i1", { status: "confirmed" as const, total: 60000, paid: 0, companyMatch: true }],
    ["i2", { status: "confirmed" as const, total: 60000, paid: 0, companyMatch: true }],
    ["i3", { status: "confirmed" as const, total: 100000, paid: 0, companyMatch: true }],
  ]);
  it("120,000円を60,000円×2件へ配分できる", () => {
    expect(validateAllocations({ amount: 120000, allocated: 0 }, [{ invoiceId: "i1", amount: 60000 }, { invoiceId: "i2", amount: 60000 }], invs)).toEqual([]);
  });
  it("入金額超過を拒否", () => {
    expect(validateAllocations({ amount: 100000, allocated: 0 }, [{ invoiceId: "i1", amount: 60000 }, { invoiceId: "i2", amount: 60000 }], invs).length).toBeGreaterThan(0);
  });
  it("請求残額超過を拒否", () => {
    expect(validateAllocations({ amount: 200000, allocated: 0 }, [{ invoiceId: "i1", amount: 70000 }], invs).length).toBeGreaterThan(0);
  });
  it("部分入金で残額40,000円", () => {
    expect(derivePaymentState({ status: "confirmed", total: 100000, paid: 60000, dueDate: "2099-01-01" })).toBe("partial");
  });
  it("期限超過は算出", () => {
    expect(derivePaymentState({ status: "confirmed", total: 100000, paid: 0, dueDate: "2026-01-01" }, "2026-02-01")).toBe("overdue");
  });
  it("B15: 同額同名義の候補が複数なら ambiguous", () => {
    const r = matchCandidates({ amount: 60000, payerName: "ﾔﾏﾀﾞ ﾀﾛｳ" }, [
      { id: "a", remaining: 60000, payerKana: ["ヤマダタロウ"] },
      { id: "b", remaining: 60000, payerKana: ["ヤマダタロウ"] },
    ]);
    expect(r.ambiguous).toBe(true);
  });
});

describe("T09 オーナー精算", () => {
  it("回収済みのみ・料率は対象費目のみ", () => {
    const r = computeSettlement(
      [
        { allocationId: "a1", itemCode: "rent", amount: 80000 },
        { allocationId: "a2", itemCode: "common", amount: 5000 },
      ],
      { kind: "rate", rate: "0.05", targetItemCodes: ["rent"], rounding: "floor", taxRate: "0.10" },
      [{ amount: 10000 }],
      0,
    );
    expect(r.fee).toBe(4000);
    expect(r.feeTax).toBe(400);
    expect(r.payable).toBe(85000 - 4400 - 10000);
  });
  it("B20: 共有配分の合計一致", () => {
    const rows = splitAmongOwners(100001, [{ ownerId: "a", ratio: "0.5" }, { ownerId: "b", ratio: "0.5" }], "a");
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(100001);
    expect(rows.find((r) => r.ownerId === "a")!.amount).toBe(50001);
    expect(() => splitAmongOwners(100, [{ ownerId: "a", ratio: "0.6" }], "a")).toThrow();
  });
});

describe("T12 敷金", () => {
  it("返金予定では残高を減らさない", () => {
    const b = depositBalance([
      { kind: "receive", amount: 120000 },
      { kind: "apply", amount: 30000 },
      { kind: "refund_planned", amount: 90000 },
    ]);
    expect(b.balance).toBe(90000);
    expect(b.refundPending).toBe(90000);
  });
});

describe("T11 修繕負担", () => {
  it("負担合計が明細金額と一致しないと確定不可", () => {
    const line = { name: "クロス張替", quantity: "10", unit: "㎡", unitPrice: "1200", tax: tax10, burden: [{ party: "lessor" as const, amount: 6000 }, { party: "lessee" as const, amount: 5000 }] };
    expect(validateEstimateBurden([line], "floor")).toHaveLength(1);
    expect(validateEstimateBurden([{ ...line, burden: [{ party: "lessor", amount: 12000 }] }], "floor")).toHaveLength(0);
  });
});

describe("案件の状態遷移", () => {
  it("成約には契約確定が必要", () => {
    expect(validateDealTransition({ kind: "rental", customerId: "x", propertyIds: ["p"], contractStatus: "draft" }, "won")).toHaveLength(1);
    expect(validateDealTransition({ kind: "rental", customerId: "x", propertyIds: ["p"], contractStatus: "approved" }, "won")).toHaveLength(0);
  });
});

describe("CSV", () => {
  it("式インジェクション対策", () => {
    expect(safeCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(safeCell("-1+2")).toBe("'-1+2");
    expect(safeCell('a,"b"')).toBe('"a,""b"""');
  });
  it("Shift_JIS を判定・復号", () => {
    const buf = iconv.encode("入金日,金額\n2026/10/01,60000", "Shift_JIS");
    expect(detectEncoding(new Uint8Array(buf))).toBe("shift_jis");
    expect(decodeCsv(new Uint8Array(buf)).text).toContain("入金日");
  });
  it("入金行の正規化", () => {
    const r = normalizePaymentRow(["2026/10/1", "６０，０００"], { date: 0, amount: 1 });
    expect(r.ok && r.value).toMatchObject({ date: "2026-10-01", amount: 60000 });
    expect(normalizePaymentRow(["2026/02/30", "1"], { date: 0, amount: 1 }).ok).toBe(false);
  });
});

describe("B24 期限", () => {
  it("2か月前・土日は前営業日", () => {
    // 2027-03-31 の2か月前 = 2027-01-31(日) → 2027-01-29(金)
    expect(deadlineFrom("2027-03-31", { unit: "months", amount: 2, holidayAdjust: "previous_weekday" })).toBe("2027-01-29");
  });
});
