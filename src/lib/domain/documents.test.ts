import { describe, expect, it, vi } from "vitest";
import {
  resolveText, renderBlocks, rerenderBlocks, hasManualEdits, receiptAmount, requiredMissing, missingFields, countMissingText,
  describeMissing, canonical, EMPTY_LIST_TEXT, XBlock, MergeData,
} from "../server/docgen/engine";
import { sanitizeBlocks } from "../server/docgen/validate";
import { builtinTemplate } from "../server/docgen/builtin";
import type { DocBlock } from "@/lib/types";

const data = (fields: MergeData["fields"], lists: MergeData["lists"] = {}) => ({ fields, lists });

describe("変数の解決", () => {
  it("値があれば置換し、ない値は「未入力」として報告する（0 や該当なしにしない）", () => {
    const r = resolveText("{{lessee.name}} 様 賃料 {{monthly.rent}} 敷金 {{deposit.amount}}", data({ "lessee.name": "山田 太郎", "monthly.rent": "62,000円", "deposit.amount": null }));
    expect(r.text).toBe("山田 太郎 様 賃料 62,000円 敷金 未入力");
    expect(r.missing).toEqual(["deposit.amount"]);
  });

  it("未定義の項目・空文字も未入力として扱う", () => {
    const r = resolveText("{{unit.address}}/{{contract.number}}", data({ "contract.number": "  " }));
    expect(r.text).toBe("未入力/未入力");
    expect(r.missing).toEqual(["unit.address", "contract.number"]);
  });

  it("「0円」は値として表示する（未入力と区別）", () => {
    const r = resolveText("{{renewal.fee}}", data({ "renewal.fee": "0円" }));
    expect(r.text).toBe("0円");
    expect(r.missing).toEqual([]);
  });

  it("表の行展開: source の各行を展開し、行内の欠損を行番号付きで報告する", () => {
    const tpl: DocBlock[] = [
      { type: "table", columns: ["費目", "金額"], rows: [["{{item.name}}", "{{item.amount}}"], ["合計", "{{invoice.total}}"]], source: "invoice.lines" },
    ];
    const r = renderBlocks(tpl, data({ "invoice.total": "70,000円" }, { "invoice.lines": [{ name: "賃料", amount: "62,000円" }, { name: "共益費", amount: null }] }));
    const t = r.blocks[0] as Extract<DocBlock, { type: "table" }>;
    expect(t.rows).toEqual([["賃料", "62,000円"], ["共益費", "未入力"], ["合計", "70,000円"]]);
    expect(t.source).toBeUndefined();
    expect(r.missing).toEqual(["invoice.lines[1].amount"]);
    expect(describeMissing(r.missing)[0].label).toBe("請求明細 2行目 金額");
  });

  it("明細そのものが不明（null）は未入力1行＋未確認項目。空配列は「明細はありません」", () => {
    const tpl: DocBlock[] = [{ type: "table", columns: ["費目"], rows: [["{{item.name}}"]], source: "estimate.lines" }];
    const unknown = renderBlocks(tpl, data({}, { "estimate.lines": null }));
    expect((unknown.blocks[0] as Extract<DocBlock, { type: "table" }>).rows).toEqual([["未入力"]]);
    expect(unknown.missing).toEqual(["estimate.lines"]);
    const empty = renderBlocks(tpl, data({}, { "estimate.lines": [] }));
    expect((empty.blocks[0] as Extract<DocBlock, { type: "table" }>).rows).toEqual([[EMPTY_LIST_TEXT]]);
    expect(empty.missing).toEqual([]);
  });

  it("必須項目の不足を検出する", () => {
    const d = data({ "invoice.total": "1,000円", "invoice.billToName": null }, { "invoice.lines": null });
    expect(requiredMissing(["invoice.total", "invoice.billToName", "invoice.lines"], d)).toEqual(["invoice.billToName", "invoice.lines"]);
  });

  it("既定テンプレートでも未入力が本文に残り、件数を数えられる", () => {
    const tpl = builtinTemplate("renewal_notice")!;
    const d = data({ "lessee.name": "株式会社サンプル不動産管理ホールディングス", "renewal.expiresOn": "2027年3月31日" });
    const r = renderBlocks(tpl.body, d);
    expect(r.missing).toContain("renewal.proposedRent");
    expect(countMissingText(r.blocks)).toBeGreaterThan(0);
    expect(missingFields(tpl.body, d)).toEqual(r.missing);
  });
});

describe("契約関係書類", () => {
  it("既定テンプレートを持たない（書式未設定）", () => {
    for (const t of ["important_matters", "lease_contract", "sale_contract", "brokerage_contract", "renewal_agreement"]) {
      expect(builtinTemplate(t)).toBeNull();
    }
    expect(builtinTemplate("invoice")).not.toBeNull();
    expect(builtinTemplate("receipt")).not.toBeNull();
  });
});

describe("領収書の金額", () => {
  it("入金配分の合計（請求額ではない）", () => {
    const r = receiptAmount({ status: "confirmed", total: 100000 }, [{ amount: 60000, reversed: false }]);
    expect(r).toEqual({ ok: true, amount: 60000 });
  });
  it("取消された配分は含めない", () => {
    const r = receiptAmount({ status: "confirmed", total: 100000 }, [{ amount: 60000, reversed: true }, { amount: 30000, reversed: false }]);
    expect(r).toEqual({ ok: true, amount: 30000 });
  });
  it("入金がなければエラー（未入金の請求額で領収書を作らない）", () => {
    const r = receiptAmount({ status: "confirmed", total: 100000 }, []);
    expect(r.ok).toBe(false);
    const r2 = receiptAmount({ status: "confirmed", total: 100000 }, [{ amount: 50000, reversed: true }]);
    expect(r2.ok).toBe(false);
  });
  it("取消済み請求はエラー", () => {
    expect(receiptAmount({ status: "cancelled", total: 1000 }, [{ amount: 1000, reversed: false }]).ok).toBe(false);
  });
});

describe("再反映（手動修正の保護）", () => {
  const tpl: DocBlock[] = [
    { type: "heading", text: "更新のご案内", level: 1 },
    { type: "paragraph", text: "{{lessee.name}} 様" },
    { type: "paragraph", text: "賃料 {{monthly.rent}}" },
  ];
  const v1 = data({ "lessee.name": "山田 太郎", "monthly.rent": "62,000円" });
  const v2 = data({ "lessee.name": "山田 太郎", "monthly.rent": "65,000円" });

  it("未編集の変数ブロックは新しい値で描画し直す", () => {
    const r = renderBlocks(tpl, v1);
    expect(hasManualEdits(r.blocks, r.autoRendered)).toBe(false);
    const rr = rerenderBlocks(r.blocks, tpl, r.autoRendered, v2);
    expect((rr.blocks[2] as Extract<DocBlock, { type: "paragraph" }>).text).toBe("賃料 65,000円");
    expect(rr.changed).toEqual(["t2"]);
    expect(rr.skipped).toEqual([]);
    expect(hasManualEdits(rr.blocks, rr.autoRendered)).toBe(false);
  });

  it("手動修正したブロックは上書きしない", () => {
    const r = renderBlocks(tpl, v1);
    const edited: XBlock[] = r.blocks.map((b) => (b.key === "t2" ? { ...b, text: "賃料 62,000円（駐車場代を含みません）" } : b)) as XBlock[];
    expect(hasManualEdits(edited, r.autoRendered)).toBe(true);
    const rr = rerenderBlocks(edited, tpl, r.autoRendered, v2);
    expect((rr.blocks[2] as Extract<DocBlock, { type: "paragraph" }>).text).toBe("賃料 62,000円（駐車場代を含みません）");
    expect(rr.skipped).toEqual(["t2"]);
    // 他の未編集ブロックは更新対象
    expect(rr.updated).toContain("t1");
  });

  it("手動追加ブロックは保持し、追加・削除は手動修正として扱う", () => {
    const r = renderBlocks(tpl, v1);
    const added: XBlock[] = [...r.blocks, { type: "paragraph", text: "{{monthly.rent}} 手入力メモ", key: "m1", tpl: null } as XBlock];
    expect(hasManualEdits(added, r.autoRendered)).toBe(true);
    const rr = rerenderBlocks(added, tpl, r.autoRendered, v2);
    expect((rr.blocks[3] as Extract<DocBlock, { type: "paragraph" }>).text).toBe("{{monthly.rent}} 手入力メモ");
    expect(hasManualEdits(r.blocks.slice(0, 2), r.autoRendered)).toBe(true);
  });

  it("Firestore でキー順が変わっても同一と判定する", () => {
    expect(canonical({ type: "heading", text: "a", level: 1 })).toBe(canonical({ level: 1, text: "a", type: "heading" }));
  });
});

describe("ブロック入力の検証", () => {
  it("許可されていない画像・不正な種類を拒否する", () => {
    const errors: string[] = [];
    const out = sanitizeBlocks(
      JSON.stringify([
        { type: "paragraph", text: "本文", key: "t0", tpl: 0 },
        { type: "image", attachmentId: "evil" },
        { type: "script", text: "x" },
        { type: "table", columns: ["A", "B"], rows: [["1"]] },
      ]),
      errors,
      { allowSource: false, allowedImages: new Set(["ok"]) },
    );
    expect(errors.length).toBe(2);
    expect(out.length).toBe(2);
    expect((out[1] as Extract<DocBlock, { type: "table" }>).rows).toEqual([["1", ""]]);
    expect(out[0].key).toBe("t0");
  });
});

describe("T17 DOCX 出力", () => {
  it("日本語・長い住所・法人名・複数ページの明細を、編集可能な文字と表（見出し行の繰り返し）で出力する", async () => {
    vi.mock("server-only", () => ({}));
    const { renderDocx, imageInfo } = await import("../server/docgen/docx");
    const JSZip = (await import("jszip")).default;
    const longAddr = "北海道札幌市中央区北一条西二十丁目三番地四十五号 サンプル第二ビルディング北棟 一二三四号室（長い住所の折り返し確認用）";
    const corp = "株式会社グローバルリアルエステートマネジメントアンドコンサルティングホールディングス";
    const rows = Array.from({ length: 120 }, (_, i) => [`費目${i + 1}`, `${(i + 1) * 1000}円`]);
    const buf = await renderDocx(
      [
        { type: "heading", text: "請求書", level: 1 },
        { type: "paragraph", text: `${corp} 様\n${longAddr}` },
        { type: "table", columns: ["費目", "金額"], rows },
        { type: "pagebreak" },
        { type: "paragraph", text: "以上" },
      ],
      { title: "テスト", loadImage: async () => null },
    );
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain(corp);
    expect(xml).toContain(longAddr);
    expect(xml).toContain("<w:tblHeader");
    expect(xml).toContain("費目120");
    expect(xml).toContain('w:type="page"');
    const styles = await zip.file("word/styles.xml")!.async("string");
    expect(styles).toContain("游ゴシック");
    expect(imageInfo(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 1, 0, 0, 0, 0, 200, 8, 2]))).toEqual({ type: "png", width: 256, height: 200 });
  });
});
