import { describe, expect, it } from "vitest";
import {
  splitAllocationByLines, allocatableOf, paymentStatusOf, mergeAllocationRequests, paidStateOf, paymentStateWhere, dueDateFor, addPeriod,
  isPeriodLocked, buildLines, differenceLines, recalcDiff, duplicateCandidates, guessPaymentMapping, selectSettlementAllocations,
  collectedRowsOf, computeOwnerSettlement, ratioToDecimal, ownershipActiveIn, AllocationForSettlement,
} from "./billing";
import { derivePaymentState, splitAmongOwners } from "./rules";

const ex = { category: "exempt" as const, rate: "0", priceMode: "exclusive" as const };
const t10 = { category: "taxable" as const, rate: "0.10", priceMode: "exclusive" as const };

describe("配分の費目別按分", () => {
  it("比率で切捨て按分し、端数は最大の明細へ寄せる（合計一致）", () => {
    const r = splitAllocationByLines(100, [{ itemCode: "rent", amount: 62000 }, { itemCode: "common_fee", amount: 3000 }, { itemCode: "parking", amount: 5000 }]);
    expect(r.reduce((s, x) => s + x.amount, 0)).toBe(100);
    expect(r.find((x) => x.itemCode === "common_fee")!.amount).toBe(4);
    expect(r.find((x) => x.itemCode === "parking")!.amount).toBe(7);
    expect(r.find((x) => x.itemCode === "rent")!.amount).toBe(89);
  });
  it("全額配分は明細どおり、同じ費目は合算", () => {
    expect(splitAllocationByLines(65000, [{ itemCode: "rent", amount: 62000 }, { itemCode: "common_fee", amount: 3000 }])).toEqual([
      { itemCode: "rent", amount: 62000 },
      { itemCode: "common_fee", amount: 3000 },
    ]);
    expect(splitAllocationByLines(10, [{ itemCode: "a", amount: 1 }, { itemCode: "a", amount: 1 }])).toEqual([{ itemCode: "a", amount: 10 }]);
  });
  it("マイナス明細は重みに含めない", () => {
    const r = splitAllocationByLines(1000, [{ itemCode: "rent", amount: 1500 }, { itemCode: "discount", amount: -500 }]);
    expect(r).toEqual([{ itemCode: "rent", amount: 1000 }]);
  });
});

describe("T06/T07 入金配分", () => {
  it("過入金は未配分残高。返金指定分は配分不可", () => {
    const p = { amount: 120000, allocated: 100000, unallocatedDisposition: null };
    expect(allocatableOf(p)).toBe(20000);
    expect(paymentStatusOf(p)).toBe("partial");
    const r = { ...p, unallocatedDisposition: { kind: "refund" as const, amount: 20000 } };
    expect(allocatableOf(r)).toBe(0);
    expect(paymentStatusOf(r)).toBe("allocated");
    const c = { ...p, unallocatedDisposition: { kind: "carry_forward" as const, amount: 20000 } };
    expect(allocatableOf(c)).toBe(20000);
  });
  it("同じ請求への複数行は合算", () => {
    expect(mergeAllocationRequests([{ invoiceId: "a", amount: 1 }, { invoiceId: "a", amount: 2 }, { invoiceId: "b", amount: 3 }])).toEqual([
      { invoiceId: "a", amount: 3 },
      { invoiceId: "b", amount: 3 },
    ]);
  });
  it("B14: 100,000円の請求に60,000円入金 → 一部入金・残40,000円", () => {
    expect(paidStateOf(100000, 60000)).toBe("partial");
    expect(derivePaymentState({ status: "confirmed", total: 100000, paid: 60000, dueDate: "2026-12-27" }, "2026-12-01")).toBe("partial");
    expect(paidStateOf(100000, 100000)).toBe("full");
    expect(paidStateOf(-500, 0)).toBe("full");
  });
});

describe("入金状態の絞込み条件", () => {
  it("期限超過は期限 < 今日 かつ 未入金・一部入金", () => {
    expect(paymentStateWhere("overdue", "2026-10-20")).toEqual([["status", "==", "confirmed"], ["paidState", "in", ["none", "partial"]], ["dueDate", "<", "2026-10-20"]]);
    expect(paymentStateWhere("paid", "2026-10-20")).toEqual([["status", "==", "confirmed"], ["paidState", "==", "full"]]);
    expect(paymentStateWhere("n/a", "2026-10-20")).toBeNull();
  });
});

describe("請求の期日・期間・締め", () => {
  it("前月払い・当月払い・月末寄せ", () => {
    expect(dueDateFor("2026-11", 27, "prev_month")).toBe("2026-10-27");
    expect(dueDateFor("2026-02", 31, "current_month")).toBe("2026-02-28");
    expect(dueDateFor("2026-01", null, "prev_month")).toBe("2025-12-31");
    expect(addPeriod("2026-12", 1)).toBe("2027-01");
    expect(addPeriod("2026-01", -1)).toBe("2025-12");
  });
  it("B25: closedThrough 以前と個別締めは締め済み", () => {
    expect(isPeriodLocked("2026-08", "2026-09")).toBe(true);
    expect(isPeriodLocked("2026-10", "2026-09")).toBe(false);
    expect(isPeriodLocked("2026-11", "2026-09", ["2026-11"])).toBe(true);
    expect(isPeriodLocked("2026-11", null)).toBe(false);
  });
});

describe("明細と訂正", () => {
  it("十進数で数量×単価を計算し、マイナスは訂正以外で拒否", () => {
    const r = buildLines([{ itemCode: "other_taxable", name: "清掃", quantity: "1.5", unitPrice: "3333", tax: t10 }], "floor");
    expect(r.errors).toEqual([]);
    expect(r.lines[0].amount).toBe(4999);
    expect(buildLines([{ itemCode: "x", name: "値引", quantity: "1", unitPrice: "-100", tax: t10 }], "floor").errors.length).toBe(1);
    expect(buildLines([{ itemCode: "x", name: "値引", quantity: "1", unitPrice: "-100", tax: t10 }], "floor", { allowNegative: true }).errors).toEqual([]);
    expect(buildLines([{ itemCode: "", name: "", quantity: "a", unitPrice: "1", tax: t10 }], "floor").errors.length).toBeGreaterThanOrEqual(3);
  });
  it("B16: 差額明細は変更のあった費目だけ", () => {
    const orig = [{ itemCode: "rent", name: "賃料", amount: 62000, tax: ex }, { itemCode: "common_fee", name: "共益費", amount: 3000, tax: ex }];
    const corr = [{ itemCode: "rent", name: "賃料", amount: 60000, tax: ex }, { itemCode: "common_fee", name: "共益費", amount: 3000, tax: ex }, { itemCode: "parking", name: "駐車場", amount: 5000, tax: t10 }];
    const d = differenceLines(orig, corr);
    expect(d.map((x) => [x.itemCode, x.amount])).toEqual([["rent", -2000], ["parking", 5000]]);
  });
  it("B05: 契約版・金額が変わった下書きを再計算候補にする", () => {
    const lines = [{ dedupeKey: "k1__2026-11__rent__monthly", amount: 62000, contractVersionId: "v1" }, { dedupeKey: null, amount: 100, contractVersionId: null }];
    expect(recalcDiff(lines, [{ dedupeKey: "k1__2026-11__rent__monthly", amount: 62000, versionId: "v1" }]).changed).toBe(false);
    const d = recalcDiff(lines, [{ dedupeKey: "k1__2026-11__rent__monthly", amount: 65000, versionId: "v2" }]);
    expect(d.changed).toBe(true);
    expect(d.reasons.length).toBe(2);
    expect(recalcDiff(lines, []).changed).toBe(true);
  });
});

describe("T08 CSVの重複候補", () => {
  it("他の取込み・手入力と同一内容、同じファイル内の同一内容を候補にする（自分の取込みは除く）", () => {
    const rows = [{ rowNo: 1, fingerprint: "A" }, { rowNo: 2, fingerprint: "A" }, { rowNo: 3, fingerprint: "B" }, { rowNo: 4, fingerprint: null }];
    const existing = [{ id: "p1", fingerprint: "B", importBatchId: "other" }, { id: "b1_1", fingerprint: "A", importBatchId: "b1" }];
    const d = duplicateCandidates(rows, existing, "b1");
    expect(d.get(1)).toEqual({ otherIds: [], sameFileRows: [2] });
    expect(d.get(3)).toEqual({ otherIds: ["p1"], sameFileRows: [] });
    expect(d.has(4)).toBe(false);
  });
  it("列名から列対応を推測", () => {
    expect(guessPaymentMapping(["取引日", "摘要", "お預り金額", "照会番号"])).toEqual({ date: 0, amount: 2, payer: 1, reference: 3, account: undefined });
  });
});

describe("T09 オーナー精算", () => {
  const base = { reversed: false, settlementId: null, allocatedAt: "2026-10-05T01:00:00.000Z" };
  const allocs: AllocationForSettlement[] = [
    { ...base, id: "a1", propertyId: "P1", paymentDate: "2026-10-03", amount: 65000, itemBreakdown: [{ itemCode: "rent", amount: 62000 }, { itemCode: "common_fee", amount: 3000 }] },
    { ...base, id: "a2", propertyId: "P1", paymentDate: "2026-11-01", amount: 65000, itemBreakdown: [{ itemCode: "rent", amount: 65000 }] },
    { ...base, id: "a3", propertyId: "P1", paymentDate: "2026-09-30", amount: 1000, itemBreakdown: [{ itemCode: "rent", amount: 1000 }], settlementId: "S0" },
    { ...base, id: "a4", propertyId: "P1", paymentDate: "2026-09-15", amount: 2000, itemBreakdown: [{ itemCode: "rent", amount: 2000 }], reversed: true },
    { ...base, id: "a5", propertyId: "P2", paymentDate: "2026-10-01", amount: 9999, itemBreakdown: [{ itemCode: "rent", amount: 9999 }] },
    { ...base, id: "a6", propertyId: "P1", paymentDate: "2026-08-20", amount: 120000, itemBreakdown: [{ itemCode: "security_deposit", amount: 120000 }] },
  ];
  it("未精算・未取消・対象物件・入金日が対象月末以前のみ（精算済みは再利用しない）", () => {
    expect(selectSettlementAllocations(allocs, ["P1"], "2026-10").map((a) => a.id)).toEqual(["a1", "a6"]);
  });
  it("入金日がない古い配分は配分日時（日本時間）で判定", () => {
    const a = { ...base, id: "x", propertyId: "P1", amount: 1, itemBreakdown: [], allocatedAt: "2026-10-31T16:00:00.000Z" };
    expect(selectSettlementAllocations([a], ["P1"], "2026-10")).toEqual([]);
  });
  it("預り金は収入から除外し、管理料は対象費目のみ", () => {
    const sel = selectSettlementAllocations(allocs, ["P1"], "2026-10");
    const { rows, depositTotal } = collectedRowsOf(sel, new Set(["security_deposit"]));
    expect(depositTotal).toBe(120000);
    const c = computeOwnerSettlement(rows, [{ propertyId: "P1", label: "A棟", fee: { kind: "rate", rate: "0.05", targetItemCodes: ["rent"], rounding: "floor", taxRate: "0.10" } }], [{ amount: 10000 }], 0, depositTotal);
    expect(c.collectedTotal).toBe(65000);
    expect(c.feeBase).toBe(62000);
    expect(c.fee).toBe(3100);
    expect(c.feeTax).toBe(310);
    expect(c.payable).toBe(65000 - 3100 - 310 - 10000);
    expect(c.basis.some((b) => b.includes("預り金"))).toBe(true);
  });
  it("費用が上回る場合は送金0・マイナス繰越", () => {
    const c = computeOwnerSettlement([], [{ propertyId: "P1", label: "A", fee: null }], [{ amount: 5000 }], 1000);
    expect(c.payable).toBe(0);
    expect(c.carryOut).toBe(-4000);
  });
  it("B20: 持分の表記変換と共有者配分の合計一致", () => {
    expect(ratioToDecimal("1/2")).toBe("0.5");
    expect(ratioToDecimal("30%")).toBe("0.3");
    expect(ratioToDecimal("abc")).toBeNull();
    const s = splitAmongOwners(10001, [{ ownerId: "a", ratio: ratioToDecimal("1/2")! }, { ownerId: "b", ratio: "0.5" }], "b");
    expect(s.reduce((x, r) => x + r.amount, 0)).toBe(10001);
  });
  it("所有関係の適用期間", () => {
    expect(ownershipActiveIn({ from: "2026-10-15", to: null }, "2026-10")).toBe(true);
    expect(ownershipActiveIn({ from: "2020-01-01", to: "2026-09-30" }, "2026-10")).toBe(false);
  });
});
