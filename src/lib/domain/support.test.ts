import { describe, expect, it } from "vitest";
import {
  computeEstimate,
  validateEstimateLines,
  estimateDiff,
  isInquiryOverdue,
  noticeDeadlineSoon,
  inviteState,
  isShareable,
  shareLinkState,
  parseShareToken,
  effectiveAt,
  jstDayRangeIso,
  remainingOf,
  parseScope,
  validateRepairTransition,
  EstimateLineInput,
} from "../labels-support";
import { validateEstimateBurden } from "./rules";

const t10 = { category: "taxable", rate: "0.10", priceMode: "exclusive" } as const;
const line = (p: Partial<EstimateLineInput>): EstimateLineInput => ({
  name: "クロス張替", quantity: "10", unit: "㎡", unitPrice: "1200", tax: t10, burden: [{ party: "lessor", amount: 12000 }], ...p,
});

describe("見積計算（B22）", () => {
  it("明細金額・税・合計を計算し、負担合計の一致を判定する", () => {
    const r = computeEstimate([line({}), line({ name: "床補修", quantity: "1.5", unitPrice: "3333", burden: [{ party: "lessee", amount: 3000 }, { party: "lessor", amount: 1999 }] })], "floor", "floor");
    expect(r.lines[0].amount).toBe(12000);
    expect(r.lines[1].amount).toBe(4999);
    expect(r.lines[1].burdenMatches).toBe(true);
    expect(r.subtotal).toBe(16999);
    expect(r.tax).toBe(1699);
    expect(r.total).toBe(18698);
    expect(r.burdenByParty).toEqual({ lessor: 13999, lessee: 3000 });
  });
  it("負担額合計が明細金額と一致しない場合は確定不可（validateEstimateBurden と一致）", () => {
    const lines = [line({ burden: [{ party: "lessor", amount: 10000 }] })];
    expect(computeEstimate(lines, "floor", "floor").lines[0].burdenMatches).toBe(false);
    expect(validateEstimateBurden(lines, "floor")).toHaveLength(1);
  });
  it("入力検証: 数量・単価・負担額", () => {
    expect(validateEstimateLines([line({ quantity: "abc" })])).toHaveLength(1);
    expect(validateEstimateLines([line({ burden: [{ party: "lessor", amount: 1.5 }] })])).toHaveLength(1);
    expect(validateEstimateLines([line({ name: " " })])).toHaveLength(1);
    expect(validateEstimateLines([line({})])).toEqual([]);
  });
});

describe("追加・変更版の差額（B23）", () => {
  it("差額と追加・削除・変更項目", () => {
    const d = estimateDiff(
      { lines: [{ name: "A", amount: 1000 }, { name: "B", amount: 500 }], total: 1650 },
      { lines: [{ name: "A", amount: 1200 }, { name: "C", amount: 300 }], total: 1650 + 0 },
    );
    expect(d.added).toEqual(["C"]);
    expect(d.removed).toEqual(["B"]);
    expect(d.changed).toEqual([{ name: "A", before: 1000, after: 1200 }]);
    expect(estimateDiff({ lines: [], total: 1000 }, { lines: [], total: 1500 }).totalDiff).toBe(500);
  });
});

describe("修繕の状態遷移", () => {
  it("発注記録は承認済み見積が必要", () => {
    expect(validateRepairTransition("awaiting_approval", "ordered", { currentEstimateStatus: "submitted", reason: null })).toHaveLength(1);
    expect(validateRepairTransition("awaiting_approval", "ordered", { currentEstimateStatus: "approved", reason: null })).toEqual([]);
  });
  it("完了は完了確認でのみ設定、中止は理由必須", () => {
    expect(validateRepairTransition("awaiting_completion_check", "completed", { currentEstimateStatus: null, reason: null }).length).toBeGreaterThan(0);
    expect(validateRepairTransition("received", "cancelled", { currentEstimateStatus: null, reason: null })).toHaveLength(1);
  });
});

describe("期限", () => {
  it("問い合わせの期限超過", () => {
    expect(isInquiryOverdue({ due: "2026-10-19", status: "open" }, "2026-10-20")).toBe(true);
    expect(isInquiryOverdue({ due: "2026-10-20", status: "open" }, "2026-10-20")).toBe(false);
    expect(isInquiryOverdue({ due: "2026-10-01", status: "done" }, "2026-10-20")).toBe(false);
    expect(isInquiryOverdue({ due: null, status: "open" }, "2026-10-20")).toBe(false);
  });
  it("更新案内期限14日以内", () => {
    expect(noticeDeadlineSoon("2026-11-03", "2026-10-20")).toBe(true);
    expect(noticeDeadlineSoon("2026-11-04", "2026-10-20")).toBe(false);
    expect(noticeDeadlineSoon("2026-10-19", "2026-10-20")).toBe(false);
  });
});

describe("招待コード・共有リンク", () => {
  const now = "2026-10-20T00:00:00.000Z";
  it("招待コードの状態", () => {
    expect(inviteState({ usedBy: "u", expiresAt: "2000-01-01" }, now)).toBe("used");
    expect(inviteState({ revoked: true, expiresAt: "2999-01-01" }, now)).toBe("revoked");
    expect(inviteState({ expiresAt: "2026-10-19T00:00:00.000Z" }, now)).toBe("expired");
    expect(inviteState({ expiresAt: "2026-10-21T00:00:00.000Z" }, now)).toBe("active");
  });
  it("契約・精算・本人確認資料は共有リンクの対象外", () => {
    expect(isShareable("proposal_view", "proposal")).toBe(true);
    for (const e of ["contract", "settlement", "party", "document", "attachment"]) expect(isShareable("proposal_view", e)).toBe(false);
    expect(isShareable("doc_submit", "contract")).toBe(false);
  });
  it("期限切れ・失効", () => {
    expect(shareLinkState({ revoked: false, expiresAt: "2026-10-21T00:00:00.000Z" }, now)).toBe("active");
    expect(shareLinkState({ revoked: false, expiresAt: now }, now)).toBe("expired");
    expect(shareLinkState({ revoked: true, expiresAt: "2999-01-01" }, now)).toBe("revoked");
  });
  it("トークン形式", () => {
    expect(parseShareToken("abcDEF123." + "x".repeat(43))).toEqual({ companyId: "abcDEF123" });
    expect(parseShareToken("../etc." + "x".repeat(43))).toBeNull();
    expect(parseShareToken("abc.short")).toBeNull();
  });
});

describe("設定の適用開始日", () => {
  it("基準日時点で有効な最新の設定を選ぶ（将来分は適用しない）", () => {
    const h = [
      { effectiveFrom: "2026-01-01", v: 1 },
      { effectiveFrom: "2026-10-01", v: 2 },
      { effectiveFrom: "2027-04-01", v: 3 },
    ];
    expect(effectiveAt(h, "2026-10-20")?.v).toBe(2);
    expect(effectiveAt(h, "2025-12-31")).toBeNull();
    expect(effectiveAt(h, "2027-04-01")?.v).toBe(3);
  });
});

describe("集計補助", () => {
  it("日本時間の日付範囲", () => {
    expect(jstDayRangeIso("2026-10-01", "2026-10-31")).toEqual({ start: "2026-09-30T15:00:00.000Z", end: "2026-10-31T15:00:00.000Z" });
  });
  it("残額は負にしない", () => {
    expect(remainingOf({ total: 100000, paid: 60000 })).toBe(40000);
    expect(remainingOf({ total: 100, paid: 200 })).toBe(0);
  });
  it("対象範囲", () => {
    expect(parseScope("store")).toBe("store");
    expect(parseScope("x")).toBe("mine");
  });
});
