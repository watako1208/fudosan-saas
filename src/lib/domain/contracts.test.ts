import { describe, expect, it } from "vitest";
import {
  leaseConfirmErrors,
  saleConfirmErrors,
  firstMonthProration,
  validateChangeEffectiveFrom,
  previousEffectiveTo,
  versionAt,
  versionRangeErrors,
  versionAmountDiff,
  renewalSourceKey,
  noticeDeadlineFromRule,
  isRenewalTarget,
  renewedPeriod,
  earliestTerminationDate,
  moveoutImpact,
  depositByHolder,
  depositEntryErrors,
} from "./contracts";
import { findOverlappingContracts } from "./rules";

const exempt = { category: "exempt" as const, rate: "0", priceMode: "exclusive" as const };
const actual = { method: "actual" as const, rounding: "floor" as const };

const okLease = {
  parties: [{ role: "lessor" }, { role: "lessee" }],
  unitId: "u1",
  leaseType: "ordinary" as const,
  start: "2026-10-16",
  end: "2028-10-15",
  monthlyItems: [{ code: "rent", amount: 62000 }],
  documentsChecked: true,
  depositAmount: 62000,
  depositHolder: "company",
};

describe("B03 契約確定の検証", () => {
  it("必要項目が揃っていればエラーなし", () => {
    expect(leaseConfirmErrors(okLease)).toEqual([]);
  });
  it("当事者・部屋・期間・費用・書類確認の不足をすべて列挙する", () => {
    const e = leaseConfirmErrors({ ...okLease, parties: [], unitId: null, start: null, monthlyItems: [], documentsChecked: false, leaseType: null });
    expect(e).toContain("貸主が登録されていません");
    expect(e).toContain("借主が登録されていません");
    expect(e).toContain("対象の部屋・区画が選択されていません");
    expect(e).toContain("契約開始日が入力されていません");
    expect(e).toContain("月額費用が1件も設定されていません");
    expect(e).toContain("契約書類の確認が完了していません");
  });
  it("定期借家は終了日必須、敷金があれば保管主体必須", () => {
    const e = leaseConfirmErrors({ ...okLease, leaseType: "fixed_term", end: null, depositHolder: null });
    expect(e).toContain("定期借家契約は契約終了日が必須です");
    expect(e.some((x) => x.includes("保管主体"))).toBe(true);
  });
  it("売買: 手付金＋残代金が売買代金と一致しない場合はエラー", () => {
    const base = {
      parties: [{ role: "seller" }, { role: "buyer" }],
      propertyIds: ["p1", "p2"],
      salePrice: 30000000,
      earnestMoney: 3000000,
      balanceAmount: 27000000,
      contractDate: "2026-11-01",
      settlementDate: "2026-12-15",
      deliveryDate: "2026-12-15",
      documentsChecked: true,
    };
    expect(saleConfirmErrors(base)).toEqual([]);
    expect(saleConfirmErrors({ ...base, balanceAmount: 26000000 }).some((x) => x.includes("一致しません"))).toBe(true);
    expect(saleConfirmErrors({ ...base, settlementDate: "2026-10-01" })).toContain("決済予定日が契約日より前です");
  });
});

describe("B04/T03 契約期間の重複", () => {
  const current = { id: "c1", unitId: "u1", status: "active", start: "2024-11-01", end: "2026-10-31" };
  it("重なる確定契約を検出する", () => {
    expect(findOverlappingContracts({ id: "c2", unitId: "u1", start: "2026-10-15", end: null }, [current])).toHaveLength(1);
  });
  it("現在契約の終了翌日から始まる将来の契約は登録できる", () => {
    expect(findOverlappingContracts({ id: "c2", unitId: "u1", start: "2026-11-01", end: "2028-10-31" }, [current])).toHaveLength(0);
  });
  it("下書き・取消の契約は占有に数えない", () => {
    expect(findOverlappingContracts({ id: "c2", unitId: "u1", start: "2026-10-01", end: null }, [{ ...current, status: "cancelled" }])).toHaveLength(0);
  });
});

describe("B09 日割りの確認表示", () => {
  it("開始月の日割り（62,000円・10/16開始 → 32,000円）と計算式", () => {
    const r = firstMonthProration([{ code: "rent", name: "賃料", amount: 62000, proration: actual }], "2026-10-16");
    expect(r[0].result?.amount).toBe(32000);
    expect(r[0].result?.formula).toContain("16日 ÷ 31日");
    expect(r[0].to).toBe("2026-10-31");
  });
  it("金額未入力は計算せず理由を返す", () => {
    const r = firstMonthProration([{ code: "rent", name: "賃料", amount: null }], "2026-10-16");
    expect(r[0].result).toBeNull();
    expect(r[0].error).toBe("金額未入力");
  });
  it("不正な日付では空", () => {
    expect(firstMonthProration([{ code: "rent", name: "賃料", amount: 1 }], "")).toEqual([]);
  });
});

describe("B05 契約版の適用期間", () => {
  it("変更開始日は現在の版より後でなければならない", () => {
    expect(validateChangeEffectiveFrom("2026-04-01", "2026-04-01", null)).toHaveLength(1);
    expect(validateChangeEffectiveFrom("2026-04-01", "2026-05-01", null)).toEqual([]);
    expect(validateChangeEffectiveFrom("2026-04-01", null, null)).toHaveLength(1);
    expect(validateChangeEffectiveFrom("2026-04-01", "2027-05-01", "2027-03-31")).toHaveLength(1);
  });
  it("前の版の適用終了日は変更開始日の前日（月またぎ・うるう年）", () => {
    expect(previousEffectiveTo("2026-11-01")).toBe("2026-10-31");
    expect(previousEffectiveTo("2028-03-01")).toBe("2028-02-29");
  });
  it("指定日に適用される確定版を返す（下書きは対象外）", () => {
    const vs = [
      { id: "v1", versionNo: 1, status: "confirmed" as const, effectiveFrom: "2026-01-01", effectiveTo: "2026-06-30" },
      { id: "v2", versionNo: 2, status: "confirmed" as const, effectiveFrom: "2026-07-01", effectiveTo: null },
      { id: "v3", versionNo: 3, status: "draft" as const, effectiveFrom: "2026-09-01", effectiveTo: null },
    ];
    expect(versionAt(vs, "2026-06-30")?.id).toBe("v1");
    expect(versionAt(vs, "2026-07-01")?.id).toBe("v2");
    expect(versionAt(vs, "2026-10-01")?.id).toBe("v2");
    expect(versionAt(vs, "2025-12-31")).toBeNull();
    expect(versionRangeErrors(vs)).toEqual([]);
    expect(versionRangeErrors([{ ...vs[0], effectiveTo: "2026-06-29" }, vs[1]])).toHaveLength(1);
  });
  it("版の金額差分", () => {
    const d = versionAmountDiff(
      { monthlyItems: [{ code: "rent", name: "賃料", amount: 62000 }, { code: "common_fee", name: "共益費", amount: 3000 }], depositAmount: 62000 },
      { monthlyItems: [{ code: "rent", name: "賃料", amount: 65000 }, { code: "common_fee", name: "共益費", amount: 3000 }], depositAmount: 62000, end: "2028-10-31" },
    );
    expect(d).toEqual([
      { label: "月額: 賃料", before: 62000, after: 65000, delta: 3000 },
      { label: "契約終了日", before: null, after: "2028-10-31", delta: null },
    ]);
  });
});

describe("S21 更新対象の抽出", () => {
  it("抽出キーは契約と満了日の組合せ", () => {
    expect(renewalSourceKey("c1", "2027-03-31")).toBe("c1__2027-03-31");
  });
  it("B24: 期限は契約版のルールから計算（2か月前・前営業日調整）", () => {
    // 2027-01-31 は日曜 → 前営業日 2027-01-29（金）
    expect(noticeDeadlineFromRule("2027-03-31", { base: "contract_end", unit: "months", amount: 2, holidayAdjust: "previous_weekday" })).toBe("2027-01-29");
    expect(noticeDeadlineFromRule("2027-03-31", { base: "contract_end", unit: "days", amount: 30, holidayAdjust: "none" })).toBe("2027-03-01");
    expect(noticeDeadlineFromRule("2027-03-31", null)).toBeNull();
  });
  it("対象期間内の締結済み・契約期間中の賃貸契約のみ", () => {
    expect(isRenewalTarget({ kind: "lease", status: "active", end: "2027-01-31" }, "2026-10-20", 120)).toBe(true);
    expect(isRenewalTarget({ kind: "lease", status: "active", end: "2027-03-31" }, "2026-10-20", 120)).toBe(false);
    expect(isRenewalTarget({ kind: "lease", status: "draft", end: "2027-01-31" }, "2026-10-20", 120)).toBe(false);
    expect(isRenewalTarget({ kind: "sale", status: "active", end: "2027-01-31" }, "2026-10-20", 120)).toBe(false);
    expect(isRenewalTarget({ kind: "lease", status: "active", end: "2026-10-19" }, "2026-10-20", 120)).toBe(false);
  });
  it("更新後の期間（翌日から24か月、両端含む）", () => {
    expect(renewedPeriod("2026-10-31", 24)).toEqual({ effectiveFrom: "2026-11-01", newEnd: "2028-10-31" });
    expect(renewedPeriod("2028-02-28", 12)).toEqual({ effectiveFrom: "2028-02-29", newEnd: "2029-02-27" });
  });
});

describe("S22 解約日変更の影響", () => {
  const items = [
    { code: "rent", name: "賃料", amount: 62000, tax: exempt, proration: actual },
    { code: "common_fee", name: "共益費", amount: 3100, tax: exempt, proration: { method: "none" as const, rounding: "floor" as const } },
  ];
  const invoices = [
    { id: "i1", number: "INV-1", kind: "monthly", period: "2026-11", status: "confirmed", total: 65100 },
    { id: "i2", number: "INV-2", kind: "monthly", period: "2026-12", status: "draft", total: 65100 },
    { id: "i3", number: "INV-3", kind: "monthly", period: "2026-10", status: "confirmed", total: 65100 },
    { id: "i4", number: "INV-4", kind: "monthly", period: "2026-12", status: "cancelled", total: 65100 },
  ];
  it("最終月の日割りと影響する請求（対象月以降・取消除く）", () => {
    const r = moveoutImpact({ confirmedDate: "2026-11-15", contractStart: "2024-11-01", contractEnd: "2026-10-31", versionFrom: "2024-11-01", monthlyItems: items, invoices })!;
    expect(r.finalPeriod).toBe("2026-11");
    expect(r.endBefore).toBe("2026-10-31");
    expect(r.finalMonth[0].result?.amount).toBe(31000); // 15/30 × 62,000
    expect(r.finalMonth[1].result?.amount).toBe(3100); // 日割りなし
    expect(r.affectedInvoices.map((i) => i.id)).toEqual(["i1", "i2"]);
  });
  it("月途中開始の契約で同月解約なら開始日から日割り", () => {
    const r = moveoutImpact({ confirmedDate: "2026-11-20", contractStart: "2026-11-11", contractEnd: null, versionFrom: "2026-11-11", monthlyItems: items.slice(0, 1), invoices: [] })!;
    expect(r.finalMonth[0].from).toBe("2026-11-11");
    expect(r.finalMonth[0].result?.days).toBe(10);
  });
  it("最短解約日（1か月前予告）", () => {
    expect(earliestTerminationDate("2026-10-20", { unit: "months", amount: 1 })).toBe("2026-11-20");
    expect(earliestTerminationDate("2026-10-20", null)).toBeNull();
  });
});

describe("T12 敷金の保管主体", () => {
  const entries = [
    { kind: "receive" as const, amount: 100000, holder: "lessor" as const },
    { kind: "receive" as const, amount: 50000, holder: "company" as const },
    { kind: "apply" as const, amount: 30000, approved: true, holder: "lessor" as const },
    { kind: "apply" as const, amount: 10000, approved: false, holder: "lessor" as const },
    { kind: "refund_planned" as const, amount: 60000, holder: "lessor" as const },
  ];
  it("貸主保管分を自社残高に含めない／未実行の返金予定で残高を減らさない", () => {
    const r = depositByHolder(entries);
    expect(r.company.balance).toBe(50000);
    expect(r.lessor.balance).toBe(70000);
    expect(r.lessor.refundPending).toBe(60000);
    expect(r.other.balance).toBe(0);
  });
  it("残高を超える充当・返金実行は不可（未承認の充当も差し引いて判定）", () => {
    expect(depositEntryErrors(entries, { kind: "refund_executed", amount: 60000, holder: "lessor" })).toEqual([]);
    expect(depositEntryErrors(entries, { kind: "refund_executed", amount: 60001, holder: "lessor" })).toHaveLength(1);
    expect(depositEntryErrors(entries, { kind: "additional_charge", amount: 999999, holder: "lessor" })).toEqual([]);
    expect(depositEntryErrors(entries, { kind: "apply", amount: 0, holder: "company" })).toHaveLength(1);
  });
});
