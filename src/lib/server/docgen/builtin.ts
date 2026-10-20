// 標準書類のシステム既定テンプレート（登録不要で利用可能）。
// 契約関係書類（重要事項説明書・賃貸借契約書・売買契約書・媒介契約書・更新合意書）は既定テンプレートを持たない。
// 確認済みテンプレートが登録されていなければ「書式未設定」とし、契約書を装った仮書類を出力しない。

import type { DocBlock, TemplateDoc } from "@/lib/types";
import { DOC_TYPES } from "../../labels-documents";

const h = (text: string, level: 1 | 2 | 3 = 1): DocBlock => ({ type: "heading", text, level });
const p = (text: string): DocBlock => ({ type: "paragraph", text });
const t = (columns: string[], rows: string[][], source?: string): DocBlock => (source ? { type: "table", columns, rows, source } : { type: "table", columns, rows });
const sp = (height = 12): DocBlock => ({ type: "spacer", height });

const issuer = p("{{company.name}}\n書類番号: {{doc.number}}　作成日: {{doc.date}}");

interface Builtin {
  name: string;
  body: DocBlock[];
  requiredFields: string[];
}

const BUILTIN: Record<string, Builtin> = {
  property_intro: {
    name: "物件紹介資料（標準）",
    requiredFields: ["property.name", "property.address"],
    body: [
      h("物件紹介資料"),
      issuer,
      h("{{property.name}}", 2),
      t(["項目", "内容"], [
        ["物件番号", "{{property.number}}"],
        ["所在地", "{{property.address}}"],
        ["交通", "{{property.access}}"],
        ["構造", "{{property.structure}}"],
        ["築年月", "{{property.builtYearMonth}}"],
        ["階数", "{{property.floors}}"],
        ["権利", "{{property.rights}}"],
      ]),
      h("募集条件", 2),
      t(["項目", "内容"], [
        ["賃料", "{{listing.rent}}"],
        ["共益費", "{{listing.commonFee}}"],
        ["敷金", "{{listing.deposit}}"],
        ["礼金", "{{listing.keyMoney}}"],
        ["価格", "{{listing.price}}"],
        ["入居・引渡可能日", "{{listing.availableFrom}}"],
      ]),
      h("担当コメント", 3),
      p("{{listing.comment}}"),
    ],
  },
  comparison: {
    name: "物件比較表（標準）",
    requiredFields: ["deal.properties"],
    body: [
      h("物件比較表"),
      issuer,
      p("{{customer.name}} 様へのご提案物件です。"),
      t(
        ["物件名", "所在地", "間取り", "面積", "賃料", "共益費", "敷金", "礼金", "価格", "入居可能日"],
        [["{{item.name}}", "{{item.address}}", "{{item.layout}}", "{{item.area}}", "{{item.rent}}", "{{item.commonFee}}", "{{item.deposit}}", "{{item.keyMoney}}", "{{item.price}}", "{{item.availableFrom}}"]],
        "deal.properties",
      ),
      sp(),
      p("担当: {{deal.assignee}}"),
    ],
  },
  viewing_guide: {
    name: "内見案内（標準）",
    requiredFields: ["customer.name", "deal.viewings"],
    body: [
      h("内見のご案内"),
      issuer,
      p("{{customer.name}} 様\n\n下記のとおり内見のご案内を申し上げます。"),
      t(["日時", "集合場所", "物件", "鍵の受取"], [["{{item.at}}", "{{item.place}}", "{{item.property}}", "{{item.keyPickup}}"]], "deal.viewings"),
      sp(),
      p("ご不明な点は担当（{{deal.assignee}}）までお問い合わせください。"),
    ],
  },
  required_docs: {
    name: "必要書類一覧（標準）",
    requiredFields: [],
    body: [
      h("必要書類一覧"),
      issuer,
      p("お手続きにあたり、下記の書類をご用意ください。"),
      t(["書類", "提出状況"], [["{{item.name}}", "{{item.status}}"]], "deal.requiredDocs"),
    ],
  },
  initial_costs: {
    name: "初期費用明細（標準）",
    requiredFields: ["lessee.name", "contract.initialItems"],
    body: [
      h("初期費用明細"),
      issuer,
      p("{{lessee.name}} 様"),
      t(["項目", "内容"], [
        ["物件", "{{property.name}} {{unit.number}}"],
        ["所在地", "{{unit.address}}"],
        ["契約期間", "{{contract.start}} 〜 {{contract.end}}"],
      ]),
      h("初期費用", 2),
      t(["費目", "金額", "税区分"], [["{{item.name}}", "{{item.amount}}", "{{item.tax}}"], ["合計", "{{initial.total}}", ""]], "contract.initialItems"),
      h("月額費用", 2),
      t(["費目", "月額", "税区分"], [["{{item.name}}", "{{item.amount}}", "{{item.tax}}"], ["月額合計", "{{monthly.total}}", ""]], "contract.monthlyItems"),
    ],
  },
  invoice: {
    name: "請求書（標準）",
    requiredFields: ["invoice.billToName", "invoice.total", "invoice.issueDate", "invoice.lines"],
    body: [
      h("請求書"),
      issuer,
      p("{{invoice.billToName}} 様\n{{invoice.billToAddress}}"),
      t(["項目", "内容"], [
        ["請求番号", "{{invoice.number}}"],
        ["請求日", "{{invoice.issueDate}}"],
        ["対象月", "{{invoice.period}}"],
        ["お支払期限", "{{invoice.dueDate}}"],
        ["ご請求金額（税込）", "{{invoice.total}}"],
      ]),
      h("明細", 2),
      t(
        ["費目", "対象", "数量", "単価", "金額", "税区分"],
        [["{{item.name}}", "{{item.period}}", "{{item.quantity}}", "{{item.unitPrice}}", "{{item.amount}}", "{{item.tax}}"], ["小計（税抜）", "", "", "", "{{invoice.subtotal}}", ""], ["消費税", "", "", "", "{{invoice.tax}}", ""], ["合計", "", "", "", "{{invoice.total}}", ""]],
        "invoice.lines",
      ),
    ],
  },
  receipt: {
    name: "領収書（標準）",
    requiredFields: ["receipt.amount", "receipt.date", "receipt.payerName"],
    body: [
      h("領収書"),
      issuer,
      p("{{receipt.payerName}} 様"),
      h("金額　{{receipt.amount}}", 2),
      p("上記金額を正に領収いたしました。\n但し 請求番号 {{invoice.number}}（{{invoice.period}}分）のお支払いとして"),
      t(["入金日", "充当額"], [["{{item.date}}", "{{item.amount}}"]], "receipt.payments"),
      p("最終入金日: {{receipt.date}}"),
    ],
  },
  owner_report: {
    name: "オーナー収支報告（標準）",
    requiredFields: ["owner.name", "settlement.period", "settlement.payable"],
    body: [
      h("オーナー収支報告書"),
      issuer,
      p("{{owner.name}} 様\n対象月: {{settlement.period}}\n対象物件: {{settlement.properties}}"),
      t(["項目", "金額"], [
        ["回収済み家賃等", "{{settlement.collected}}"],
        ["管理料", "{{settlement.fee}}"],
        ["管理料消費税", "{{settlement.feeTax}}"],
        ["立替費用", "{{settlement.expenses}}"],
        ["前月繰越", "{{settlement.carryIn}}"],
        ["送金予定額", "{{settlement.payable}}"],
        ["次月繰越", "{{settlement.carryOut}}"],
        ["送金記録額", "{{settlement.remitted}}"],
      ]),
      h("立替費用の内訳", 2),
      t(["内容", "金額"], [["{{item.name}}", "{{item.amount}}"]], "settlement.expenses"),
      h("計算根拠", 2),
      t(["内容"], [["{{item.text}}"]], "settlement.basis"),
    ],
  },
  repair_estimate: {
    name: "修繕見積書（標準）",
    requiredFields: ["estimate.lines", "estimate.total"],
    body: [
      h("修繕見積書"),
      issuer,
      t(["項目", "内容"], [
        ["修繕番号", "{{repair.number}}"],
        ["物件", "{{property.name}} {{unit.number}}"],
        ["所在地", "{{property.address}}"],
        ["対象設備", "{{repair.equipment}}"],
        ["症状", "{{repair.symptom}}"],
        ["業者", "{{vendor.name}}"],
        ["見積版", "{{estimate.versionNo}}"],
      ]),
      h("見積明細", 2),
      t(
        ["項目", "数量", "単位", "単価", "金額", "負担"],
        [["{{item.name}}", "{{item.quantity}}", "{{item.unit}}", "{{item.unitPrice}}", "{{item.amount}}", "{{item.burden}}"], ["小計（税抜）", "", "", "", "{{estimate.subtotal}}", ""], ["消費税", "", "", "", "{{estimate.tax}}", ""], ["合計", "", "", "", "{{estimate.total}}", ""]],
        "estimate.lines",
      ),
    ],
  },
  repair_report: {
    name: "修繕報告書（標準）",
    requiredFields: ["repair.symptom"],
    body: [
      h("修繕報告書"),
      issuer,
      t(["項目", "内容"], [
        ["修繕番号", "{{repair.number}}"],
        ["物件", "{{property.name}} {{unit.number}}"],
        ["所在地", "{{property.address}}"],
        ["対象設備", "{{repair.equipment}}"],
        ["症状", "{{repair.symptom}}"],
        ["業者", "{{vendor.name}}"],
        ["施工予定日", "{{repair.scheduledDate}}"],
        ["完了日", "{{repair.completedAt}}"],
        ["状態", "{{repair.status}}"],
      ]),
      h("施工内容", 2),
      t(["項目", "数量", "単位", "金額", "負担"], [["{{item.name}}", "{{item.quantity}}", "{{item.unit}}", "{{item.amount}}", "{{item.burden}}"]], "estimate.lines"),
      h("施工前後の写真", 2),
      p("（写真は「画像」ブロックで追加してください）"),
    ],
  },
  renewal_notice: {
    name: "更新案内（標準）",
    requiredFields: ["lessee.name", "renewal.expiresOn"],
    body: [
      h("賃貸借契約 更新のご案内"),
      issuer,
      p("{{lessee.name}} 様\n\n現在ご契約中の下記物件について、契約満了日が近づいております。更新条件をご確認のうえ、回答期限までにご回答ください。"),
      t(["項目", "内容"], [
        ["物件", "{{property.name}} {{unit.number}}"],
        ["所在地", "{{unit.address}}"],
        ["契約番号", "{{contract.number}}"],
        ["契約満了日", "{{renewal.expiresOn}}"],
        ["回答期限", "{{renewal.noticeDeadline}}"],
        ["更新後賃料", "{{renewal.proposedRent}}"],
        ["更新料", "{{renewal.proposedFee}}"],
        ["更新期間", "{{renewal.proposedTermMonths}}"],
        ["備考", "{{renewal.note}}"],
      ]),
    ],
  },
  moveout_statement: {
    name: "退去精算書（標準）",
    requiredFields: ["lessee.name", "moveout.confirmedDate"],
    body: [
      h("退去精算書"),
      issuer,
      p("{{lessee.name}} 様"),
      t(["項目", "内容"], [
        ["物件", "{{property.name}} {{unit.number}}"],
        ["所在地", "{{unit.address}}"],
        ["契約番号", "{{contract.number}}"],
        ["解約申出日", "{{moveout.requestedAt}}"],
        ["確定解約日", "{{moveout.confirmedDate}}"],
        ["立会い日時", "{{moveout.inspectionAt}}"],
        ["返却鍵本数", "{{moveout.keysReturned}}"],
      ]),
      h("費用負担", 2),
      t(["項目", "負担者", "金額", "判断理由"], [["{{item.item}}", "{{item.party}}", "{{item.amount}}", "{{item.reason}}"], ["借主負担額合計", "", "{{moveout.burdenTotal}}", ""]], "moveout.burdens"),
      h("敷金精算", 2),
      t(["項目", "金額"], [
        ["敷金 受入額", "{{depositLedger.received}}"],
        ["充当額（承認済み）", "{{depositLedger.applied}}"],
        ["返金予定額", "{{depositLedger.refundPlanned}}"],
        ["返金実行額", "{{depositLedger.refunded}}"],
        ["追加請求額", "{{depositLedger.additional}}"],
        ["預り残高", "{{depositLedger.balance}}"],
        ["敷金の保管主体", "{{depositLedger.holder}}"],
        ["最終請求額", "{{moveout.finalInvoiceTotal}}"],
      ]),
    ],
  },
};

export const BUILTIN_EFFECTIVE_FROM = "2026-01-01";

export function builtinTemplateId(docType: string) {
  return `builtin:${docType}`;
}

/** 標準書類の既定テンプレート（契約関係書類は null） */
export function builtinTemplate(docType: string): TemplateDoc | null {
  const def = DOC_TYPES[docType];
  if (!def || def.contractType) return null;
  const b = BUILTIN[docType];
  if (!b) return null;
  return {
    id: builtinTemplateId(docType),
    companyId: "",
    createdAt: `${BUILTIN_EFFECTIVE_FROM}T00:00:00.000Z`,
    updatedAt: `${BUILTIN_EFFECTIVE_FROM}T00:00:00.000Z`,
    createdBy: "system",
    updatedBy: "system",
    version: 1,
    archived: false,
    docType,
    name: b.name,
    dealType: def.dealType,
    versionNo: 1,
    effectiveFrom: BUILTIN_EFFECTIVE_FROM,
    approvedBy: "system",
    approvedAt: `${BUILTIN_EFFECTIVE_FROM}T00:00:00.000Z`,
    status: "approved",
    body: b.body,
    requiredFields: b.requiredFields,
  };
}

export function builtinDocTypes(): string[] {
  return Object.keys(BUILTIN);
}
