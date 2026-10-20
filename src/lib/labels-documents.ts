// 書類モジュールのラベル・差込み項目カタログ（クライアント・サーバー共用。サーバー専用 import を持たない）
import type { Tone } from "@/components/ui";

type L = Record<string, { label: string; tone?: Tone }>;

/** 差込み元の種類 */
export type DocEntity = "contract" | "invoice" | "settlement" | "repair" | "moveout" | "renewal" | "deal" | "property";

export const DOC_ENTITY: Record<DocEntity, { label: string; href: (id: string) => string }> = {
  contract: { label: "契約", href: (id) => `/contracts/${id}` },
  invoice: { label: "請求", href: (id) => `/billing/invoices/${id}` },
  settlement: { label: "オーナー精算", href: (id) => `/settlements/${id}` },
  repair: { label: "修繕", href: (id) => `/support/repairs/${id}` },
  moveout: { label: "解約・退去", href: (id) => `/lease/moveouts/${id}` },
  renewal: { label: "更新", href: (id) => `/lease/renewals/${id}` },
  deal: { label: "仲介案件", href: (id) => `/deals/${id}` },
  property: { label: "物件", href: (id) => `/properties/${id}` },
};

export const DOC_ENTITY_KEYS = Object.keys(DOC_ENTITY) as DocEntity[];

export function entityHref(entity: string, id: string): string | null {
  const e = DOC_ENTITY[entity as DocEntity];
  return e ? e.href(id) : null;
}

export interface DocTypeDef {
  label: string;
  /** 契約関係書類: 承認済みの登録テンプレートがなければ作成不可（書式未設定） */
  contractType: boolean;
  entities: DocEntity[];
  dealType: "rent" | "sale" | "management" | "any";
}

export const DOC_TYPES: Record<string, DocTypeDef> = {
  property_intro: { label: "物件紹介資料", contractType: false, entities: ["property", "deal"], dealType: "any" },
  comparison: { label: "物件比較表", contractType: false, entities: ["deal"], dealType: "any" },
  viewing_guide: { label: "内見案内", contractType: false, entities: ["deal"], dealType: "any" },
  required_docs: { label: "必要書類一覧", contractType: false, entities: ["deal", "contract"], dealType: "any" },
  initial_costs: { label: "初期費用明細", contractType: false, entities: ["contract"], dealType: "rent" },
  invoice: { label: "請求書", contractType: false, entities: ["invoice"], dealType: "any" },
  receipt: { label: "領収書", contractType: false, entities: ["invoice"], dealType: "any" },
  owner_report: { label: "オーナー収支報告", contractType: false, entities: ["settlement"], dealType: "management" },
  repair_estimate: { label: "修繕見積", contractType: false, entities: ["repair"], dealType: "management" },
  repair_report: { label: "修繕報告", contractType: false, entities: ["repair"], dealType: "management" },
  renewal_notice: { label: "更新案内", contractType: false, entities: ["renewal"], dealType: "rent" },
  moveout_statement: { label: "退去精算書", contractType: false, entities: ["moveout"], dealType: "rent" },
  important_matters: { label: "重要事項説明書", contractType: true, entities: ["contract", "deal"], dealType: "any" },
  lease_contract: { label: "賃貸借契約書", contractType: true, entities: ["contract"], dealType: "rent" },
  sale_contract: { label: "売買契約書", contractType: true, entities: ["contract"], dealType: "sale" },
  brokerage_contract: { label: "媒介契約書", contractType: true, entities: ["contract", "deal"], dealType: "sale" },
  renewal_agreement: { label: "更新合意書", contractType: true, entities: ["renewal", "contract"], dealType: "rent" },
};

export function docTypeLabel(t: string | null | undefined): string {
  if (!t) return "—";
  return DOC_TYPES[t]?.label ?? t;
}

export const DOC_STATUS: L = {
  draft: { label: "下書き", tone: "neutral" },
  in_review: { label: "社内確認中", tone: "warn" },
  approved: { label: "承認済み", tone: "info" },
  issued: { label: "発行済み", tone: "ok" },
  superseded: { label: "旧版", tone: "neutral" },
};

export const TEMPLATE_STATUS: L = {
  draft: { label: "下書き", tone: "neutral" },
  approved: { label: "承認済み", tone: "ok" },
  retired: { label: "廃止", tone: "neutral" },
};

export const TEMPLATE_DEAL_TYPE: L = {
  any: { label: "共通" },
  rent: { label: "賃貸" },
  sale: { label: "売買" },
  management: { label: "賃貸管理" },
};

export const PUBLISH_KIND: L = {
  customer: { label: "顧客" },
  tenant: { label: "入居者" },
  owner: { label: "オーナー" },
  vendor: { label: "工事業者" },
};

/** 未入力の表示（0 や「該当なし」に置き換えない） */
export const MISSING_TEXT = "未入力";

/** 差込み項目（{{path}}）の名称。未確認項目の表示に使う */
export const FIELD_LABELS: Record<string, string> = {
  "company.name": "自社名",
  "doc.number": "書類番号",
  "doc.date": "作成日",
  "contract.number": "契約番号",
  "contract.title": "契約名",
  "contract.kind": "契約種別",
  "contract.start": "契約開始日",
  "contract.end": "契約終了日",
  "contract.leaseType": "賃貸借の種類",
  "contract.versionNo": "契約版",
  "contract.specialTerms": "特約",
  "contract.paymentDueDay": "支払期日",
  "lessor.name": "貸主 氏名・名称",
  "lessor.address": "貸主 住所",
  "lessor.phone": "貸主 電話",
  "lessee.name": "借主 氏名・名称",
  "lessee.address": "借主 住所",
  "lessee.phone": "借主 電話",
  "seller.name": "売主 氏名・名称",
  "seller.address": "売主 住所",
  "buyer.name": "買主 氏名・名称",
  "buyer.address": "買主 住所",
  "guarantor.name": "連帯保証人 氏名",
  "guarantor.address": "連帯保証人 住所",
  "property.number": "物件番号",
  "property.name": "物件名",
  "property.address": "物件所在地",
  "property.structure": "構造",
  "property.builtYearMonth": "築年月",
  "property.floors": "階数",
  "property.access": "交通",
  "property.rights": "権利",
  "property.lotNumber": "地番",
  "unit.number": "部屋番号",
  "unit.layout": "間取り",
  "unit.area": "専有面積",
  "unit.floor": "所在階",
  "unit.address": "賃貸物件の所在地（部屋番号まで）",
  "monthly.rent": "賃料（月額）",
  "monthly.commonFee": "共益費（月額）",
  "monthly.total": "月額合計",
  "deposit.amount": "敷金",
  "initial.total": "初期費用合計",
  "renewal.termMonths": "更新後の期間（月）",
  "renewal.fee": "更新料",
  "sale.price": "売買代金",
  "sale.earnestMoney": "手付金",
  "sale.balance": "残代金",
  "sale.contractDate": "契約日",
  "sale.settlementDate": "決済予定日",
  "sale.deliveryDate": "引渡日",
  "loan.amount": "融資額",
  "loan.deadline": "融資承認期限",
  "loan.lender": "融資先",
  "listing.rent": "募集賃料",
  "listing.commonFee": "募集共益費",
  "listing.deposit": "募集敷金",
  "listing.keyMoney": "募集礼金",
  "listing.price": "販売価格",
  "listing.availableFrom": "入居・引渡可能日",
  "listing.comment": "担当コメント",
  "invoice.number": "請求番号",
  "invoice.issueDate": "請求日",
  "invoice.dueDate": "支払期限",
  "invoice.period": "対象月",
  "invoice.billToName": "請求先",
  "invoice.billToAddress": "請求先住所",
  "invoice.subtotal": "小計（税抜）",
  "invoice.tax": "消費税",
  "invoice.total": "請求金額",
  "invoice.paid": "入金済額",
  "invoice.balance": "残額",
  "receipt.amount": "領収金額",
  "receipt.date": "入金日",
  "receipt.payerName": "領収書宛名",
  "settlement.number": "精算番号",
  "settlement.period": "対象月",
  "settlement.properties": "対象物件",
  "settlement.collected": "回収済み家賃等",
  "settlement.fee": "管理料",
  "settlement.feeTax": "管理料消費税",
  "settlement.expenses": "立替費用",
  "settlement.carryIn": "前月繰越",
  "settlement.payable": "送金予定額",
  "settlement.carryOut": "次月繰越",
  "settlement.remitted": "送金記録額",
  "owner.name": "オーナー 氏名・名称",
  "owner.address": "オーナー 住所",
  "repair.number": "修繕番号",
  "repair.equipment": "対象設備",
  "repair.symptom": "症状",
  "repair.status": "修繕状態",
  "repair.scheduledDate": "施工予定日",
  "repair.completedAt": "完了日",
  "vendor.name": "業者名",
  "estimate.versionNo": "見積版",
  "estimate.subtotal": "見積小計（税抜）",
  "estimate.tax": "見積消費税",
  "estimate.total": "見積合計",
  "estimate.reason": "追加・変更理由",
  "renewal.expiresOn": "契約満了日",
  "renewal.noticeDeadline": "回答期限",
  "renewal.proposedRent": "更新後賃料",
  "renewal.proposedFee": "更新料（提示）",
  "renewal.proposedTermMonths": "更新期間（提示）",
  "renewal.note": "更新条件の備考",
  "moveout.requestedAt": "解約申出日",
  "moveout.desiredDate": "希望解約日",
  "moveout.confirmedDate": "確定解約日",
  "moveout.inspectionAt": "立会い日時",
  "moveout.keysReturned": "返却鍵本数",
  "moveout.burdenTotal": "借主負担額合計",
  "moveout.finalInvoiceTotal": "最終請求額",
  "depositLedger.received": "敷金 受入額",
  "depositLedger.applied": "敷金 充当額",
  "depositLedger.refundPlanned": "返金予定額",
  "depositLedger.refunded": "返金実行額",
  "depositLedger.additional": "追加請求額",
  "depositLedger.balance": "預り残高",
  "depositLedger.holder": "敷金の保管主体",
  "deal.number": "案件番号",
  "deal.title": "案件名",
  "deal.kind": "賃貸・売買",
  "deal.conditions": "希望条件",
  "deal.assignee": "担当者",
  "customer.name": "顧客 氏名・名称",
  "customer.address": "顧客 住所",
  "customer.phone": "顧客 電話",
};

/** 表の行展開元（table.source）と列 */
export const LIST_SOURCES: Record<string, { label: string; columns: Record<string, string> }> = {
  "contract.parties": { label: "契約当事者", columns: { role: "役割", name: "氏名・名称", address: "住所", phone: "電話" } },
  "contract.monthlyItems": { label: "月額費用", columns: { name: "費目", amount: "月額", tax: "税区分" } },
  "contract.initialItems": { label: "初期費用", columns: { name: "費目", amount: "金額", tax: "税区分" } },
  "contract.properties": { label: "売買対象物件", columns: { number: "物件番号", name: "名称", address: "所在地", lotNumber: "地番" } },
  "invoice.lines": { label: "請求明細", columns: { name: "費目", period: "対象", quantity: "数量", unitPrice: "単価", amount: "金額", tax: "税区分" } },
  "receipt.payments": { label: "入金内訳", columns: { date: "入金日", amount: "充当額" } },
  "settlement.expenses": { label: "立替費用", columns: { name: "内容", amount: "金額" } },
  "settlement.basis": { label: "計算根拠", columns: { text: "内容" } },
  "estimate.lines": { label: "見積明細", columns: { name: "項目", quantity: "数量", unit: "単位", unitPrice: "単価", amount: "金額", burden: "負担" } },
  "moveout.burdens": { label: "費用負担", columns: { item: "項目", party: "負担者", amount: "金額", reason: "判断理由" } },
  "deal.properties": { label: "提案物件", columns: { number: "物件番号", name: "名称", address: "所在地", layout: "間取り", area: "面積", rent: "賃料", commonFee: "共益費", deposit: "敷金", keyMoney: "礼金", price: "価格", availableFrom: "入居可能日" } },
  "deal.viewings": { label: "内見予定", columns: { at: "日時", place: "集合場所", property: "物件", keyPickup: "鍵の受取" } },
  "deal.requiredDocs": { label: "提出書類", columns: { name: "書類", status: "提出状況" } },
  "property.units": { label: "区画", columns: { number: "部屋番号", layout: "間取り", area: "面積", occupancy: "入居状態" } },
};

export function fieldLabel(path: string): string {
  if (FIELD_LABELS[path]) return FIELD_LABELS[path];
  const m = /^(.+)\[(\d+)\]\.(\w+)$/.exec(path);
  if (m && LIST_SOURCES[m[1]]) return `${LIST_SOURCES[m[1]].label} ${Number(m[2]) + 1}行目 ${LIST_SOURCES[m[1]].columns[m[3]] ?? m[3]}`;
  if (LIST_SOURCES[path]) return LIST_SOURCES[path].label;
  return path;
}

export const BLOCK_TYPE_LABEL: Record<string, string> = {
  heading: "見出し",
  paragraph: "文章",
  table: "表",
  image: "画像",
  pagebreak: "改ページ",
  spacer: "余白",
};
