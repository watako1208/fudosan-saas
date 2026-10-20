import { describe, expect, it } from "vitest";
import {
  normPhone, normEmail, nameKey, jstLocalToIso, isoToJstLocal, jstDateOf, findOverlaps, validateOwnershipSet,
  aggregateRoles, weekStartOf, monthGrid, assignLanes,
} from "./deals";

describe("重複候補の正規化", () => {
  it("電話番号は数字のみで比較", () => {
    expect(normPhone("090-1234-5678")).toBe("09012345678");
    expect(normPhone("０９０（１２３４）５６７８")).toBe("09012345678");
    expect(normPhone("123")).toBeNull();
  });
  it("メールは小文字化", () => {
    expect(normEmail(" Taro@Example.COM ")).toBe("taro@example.com");
    expect(normEmail("abc")).toBeNull();
  });
  it("氏名＋読みは空白を無視", () => {
    expect(nameKey("山田 太郎", "ヤマダ タロウ")).toBe(nameKey("山田太郎", "ﾔﾏﾀﾞﾀﾛｳ".normalize("NFKC")));
    expect(nameKey("山田", null)).toBeNull();
  });
});

describe("日本時間の変換", () => {
  it("datetime-local は日本時間として解釈", () => {
    expect(jstLocalToIso("2026-10-20T10:00")).toBe("2026-10-20T01:00:00.000Z");
    expect(jstLocalToIso("2026-10-20T08:30")).toBe("2026-10-19T23:30:00.000Z");
    expect(jstLocalToIso("2026-02-30T10:00")).toBeNull();
    expect(jstLocalToIso("bad")).toBeNull();
  });
  it("ISO → 日本時間", () => {
    expect(isoToJstLocal("2026-10-19T23:30:00.000Z")).toBe("2026-10-20T08:30");
    expect(jstDateOf("2026-10-19T15:00:00.000Z")).toBe("2026-10-20");
  });
});

describe("予定の重複警告", () => {
  const ev = (id: string, s: string, e: string, travel: number | null = null) => ({
    id, start: jstLocalToIso(s)!, end: jstLocalToIso(e)!, travelMinutes: travel,
  });
  it("時間帯の重なり", () => {
    const r = findOverlaps(ev("a", "2026-10-20T10:00", "2026-10-20T11:00"), [ev("b", "2026-10-20T10:30", "2026-10-20T11:30")]);
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe("overlap");
  });
  it("移動時間を前後に考慮", () => {
    const others = [ev("b", "2026-10-20T11:10", "2026-10-20T12:00")];
    expect(findOverlaps(ev("a", "2026-10-20T10:00", "2026-10-20T11:00", 30), others)[0].kind).toBe("travel");
    expect(findOverlaps(ev("a", "2026-10-20T10:00", "2026-10-20T11:00", 5), others)).toHaveLength(0);
    // 相手側の移動時間も考慮
    expect(findOverlaps(ev("a", "2026-10-20T10:00", "2026-10-20T11:00"), [ev("b", "2026-10-20T11:10", "2026-10-20T12:00", 20)])).toHaveLength(1);
  });
  it("連続する予定は重複としない・自分自身は除く", () => {
    expect(findOverlaps(ev("a", "2026-10-20T10:00", "2026-10-20T11:00"), [ev("b", "2026-10-20T11:00", "2026-10-20T12:00"), ev("a", "2026-10-20T10:00", "2026-10-20T11:00")])).toHaveLength(0);
  });
});

describe("所有者の送金配分（B20）", () => {
  it("配分率の合計は100%", () => {
    expect(validateOwnershipSet([
      { partyId: "a", share: "1/2", remitRatio: "0.6", remainderReceiver: true },
      { partyId: "b", share: "1/2", remitRatio: "0.4", remainderReceiver: false },
    ])).toEqual([]);
    const e = validateOwnershipSet([
      { partyId: "a", share: "1/2", remitRatio: "0.5", remainderReceiver: true },
      { partyId: "b", share: "1/2", remitRatio: "0.4", remainderReceiver: false },
    ]);
    expect(e.some((x) => x.includes("合計"))).toBe(true);
  });
  it("一部だけの配分率は不可", () => {
    expect(validateOwnershipSet([
      { partyId: "a", share: "1/2", remitRatio: "1", remainderReceiver: true },
      { partyId: "b", share: "1/2", remitRatio: null, remainderReceiver: false },
    ]).length).toBeGreaterThan(0);
  });
  it("複数所有では端数受取は1名", () => {
    expect(validateOwnershipSet([
      { partyId: "a", share: "1/2", remitRatio: null, remainderReceiver: true },
      { partyId: "b", share: "1/2", remitRatio: null, remainderReceiver: true },
    ]).length).toBeGreaterThan(0);
    expect(validateOwnershipSet([{ partyId: "a", share: "1", remitRatio: null, remainderReceiver: false }])).toEqual([]);
  });
  it("持分の形式", () => {
    expect(validateOwnershipSet([{ partyId: "a", share: "abc", remitRatio: null, remainderReceiver: true }]).length).toBe(1);
  });
});

describe("役割の集約（T02）", () => {
  it("同じ人物に貸主と購入希望者", () => {
    expect(
      aggregateRoles(["prospect_buyer"], [
        { role: "lessor", to: null },
        { role: "owner", to: "2026-01-01" },
        { role: "seller", to: null, archived: true },
      ], "2026-10-20"),
    ).toEqual(["lessor", "prospect_buyer"]);
  });
});

describe("カレンダー", () => {
  it("週は月曜始まり", () => {
    expect(weekStartOf("2026-10-20")).toBe("2026-10-19");
    expect(weekStartOf("2026-10-25")).toBe("2026-10-19");
  });
  it("月表示は42マス", () => {
    const g = monthGrid("2026-10-20");
    expect(g).toHaveLength(42);
    expect(g[0]).toBe("2026-09-28");
  });
  it("重なる予定はレーンを分ける", () => {
    const r = assignLanes([
      { start: "2026-10-20T01:00:00Z", end: "2026-10-20T02:00:00Z" },
      { start: "2026-10-20T01:30:00Z", end: "2026-10-20T02:30:00Z" },
      { start: "2026-10-20T03:00:00Z", end: "2026-10-20T04:00:00Z" },
    ]);
    expect(r.map((x) => [x.lane, x.lanes])).toEqual([[0, 2], [1, 2], [0, 1]]);
  });
});
