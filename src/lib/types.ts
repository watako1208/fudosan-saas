// データ設計。Firestore: companies/{companyId}/{collection}/{id}
// 共通識別情報（id, companyId, createdAt, updatedAt, createdBy, updatedBy, version, archived）は BaseDoc。
// 画面表示用の番号（物件番号・契約番号など）は内部IDとは別に `number` に保存する。
// 業務日付は "YYYY-MM-DD"、操作日時は ISO 文字列。金額は円の整数。未入力は null（0 と区別）。

import type { BaseDoc } from "@/lib/server/repo";
import type { TaxSetting, ProrationSetting, Rounding } from "@/lib/domain/money";
import type { MonthlyItem, ManagementFeeSetting } from "@/lib/domain/rules";

export type { BaseDoc };

/** コレクション名の一覧（モジュール間で共有） */
export const C = {
  stores: "stores",
  itemTypes: "itemTypes",
  properties: "properties", // 土地・建物（区画の親）
  units: "units", // 部屋・駐車区画
  listings: "listings", // 募集条件（版管理）
  parties: "parties", // 人・法人
  partyRoles: "partyRoles", // 関係者の役割（人・法人 ↔ 物件/案件/契約）
  ownerships: "ownerships", // 所有・管理関係
  attachments: "attachments",
  deals: "deals",
  activities: "activities", // 対応記録（案件・問い合わせ共通）
  proposals: "proposals",
  events: "events", // 予定
  tasks: "tasks",
  applications: "applications", // 申込み
  contracts: "contracts",
  contractVersions: "contractVersions",
  templates: "templates",
  documents: "documents",
  documentVersions: "documentVersions",
  invoices: "invoices",
  chargeKeys: "chargeKeys", // B06 重複防止キー（docId = dedupeKey）
  payments: "payments",
  allocations: "allocations",
  importBatches: "importBatches",
  settlements: "settlements",
  remittances: "remittances",
  deposits: "deposits", // 預り金台帳エントリ
  inquiries: "inquiries",
  repairs: "repairs",
  estimates: "estimates", // 修繕見積（版）
  renewals: "renewals",
  moveouts: "moveouts",
  notifications: "notifications",
  auditLogs: "auditLogs",
  shareLinks: "shareLinks",
  jobRuns: "jobRuns", // 定期処理の実行履歴
  periodLocks: "periodLocks", // 月次締め
} as const;

// ───────────── 会社・店舗 ─────────────

export interface Store extends BaseDoc {
  name: string;
  address?: string | null;
  phone?: string | null;
}

export interface ItemTypeDoc extends BaseDoc {
  code: string;
  name: string;
  kind: "monthly" | "initial" | "one_time" | "deposit";
  tax: TaxSetting;
  proration: ProrationSetting;
  managementFeeTarget: boolean;
  isDeposit: boolean;
  sort: number;
  effectiveFrom: string;
}

// ───────────── 物件 ─────────────

export type PropertyKind = "land" | "building" | "condo_unit" | "house" | "parking_lot";
export type Usage = "residential" | "store" | "office" | "parking" | "other";

/** 面積: 種類・基準・単位・根拠を持ち、異なる基準を上書き統合しない */
export interface AreaValue {
  kind: "land" | "floor_total" | "exclusive" | "balcony" | "other";
  basis: "registry" | "survey" | "wall_center" | "inner" | "other";
  value: string; // 十進文字列
  unit: "m2" | "tsubo";
  sourceAttachmentId?: string | null;
  note?: string | null;
}

export interface Property extends BaseDoc {
  number: string; // 物件番号 P000001
  name: string;
  kind: PropertyKind;
  storeId: string | null;
  assigneeUid: string | null;
  postalCode: string | null;
  address: string | null;
  lotNumber: string | null; // 地番
  structure: string | null; // RC造 など
  builtYearMonth: string | null; // YYYY-MM
  floorsAbove: number | null;
  floorsBelow: number | null;
  areas: AreaValue[];
  access: { line: string; station: string; walkMin: number | null }[];
  rights: string | null; // 権利情報（所有権・借地権など）
  landIds: string[]; // 建物が建つ土地（property kind=land）
  memo: string | null;
  keywords: string[];
  // 一覧表示用の集約（募集条件保存時に更新）
  dealTypes: ("rent" | "sale")[];
  listingStatus: ListingStatus | null;
  priceLabel: string | null;
}

export type OccupancyStatus = "vacant" | "occupied" | "notice_given" | "unavailable";
export type ListingStatus = "preparing" | "open" | "applied" | "closed" | "suspended";

export interface Unit extends BaseDoc {
  propertyId: string;
  number: string; // 部屋番号
  usage: Usage;
  layout: string | null; // 1LDK
  areas: AreaValue[];
  floor: number | null;
  equipment: string[];
  occupancy: OccupancyStatus; // B02: 入居状態
  listingStatus: ListingStatus | null; // B02: 募集状態（別項目）
  currentContractId: string | null;
  expectedVacancyDate: string | null; // 退去予定日
  availableFrom: string | null; // 募集予定・入居可能日
  storeId: string | null;
  keywords: string[];
}

/** 募集条件（版）。過去の条件を残す */
export interface Listing extends BaseDoc {
  propertyId: string;
  unitId: string | null;
  dealType: "rent" | "sale";
  status: ListingStatus;
  effectiveFrom: string;
  supersededBy: string | null; // 次の版
  rent: number | null;
  commonFee: number | null;
  deposit: number | null;
  keyMoney: number | null;
  price: number | null;
  availableFrom: string | null;
  transactionMode: "owner" | "agent" | "broker_exclusive" | "broker_general" | "broker" | null; // 取引態様
  comment: string | null;
}

export interface Ownership extends BaseDoc {
  propertyId: string;
  partyId: string;
  share: string; // 持分 "1/2" または "0.5"
  remitRatio: string | null; // 送金配分率（B20）。所有持分とは別
  remainderReceiver: boolean;
  from: string;
  to: string | null;
  managementFee: ManagementFeeSetting | null;
  managedBy: string | null;
}

export interface Attachment extends BaseDoc {
  fileName: string;
  storagePath: string;
  size: number;
  contentType: string; // 実際のファイル種類（判定結果）
  category: string; // 外観・室内・間取り・契約書・本人確認 など
  description: string | null;
  takenAt: string | null;
  visibility: "internal" | "customer" | "owner" | "tenant" | "vendor" | "public_share";
  sort: number;
  sensitive: boolean; // 本人確認資料など
  quarantined: boolean;
  links: { entity: string; id: string }[]; // 関連づけ（ファイル本体とは分離）
  linkKeys: string[]; // `${entity}:${id}` 検索用
  uploadedBy: string;
}

// ───────────── 人・法人 ─────────────

export interface Party extends BaseDoc {
  number: string; // 顧客番号 C000001
  type: "person" | "corporation";
  name: string;
  kana: string | null;
  corporationId: string | null; // 法人担当者 → 所属法人
  phone: string | null;
  mobile: string | null;
  email: string | null;
  postalCode: string | null;
  address: string | null;
  birthDate: string | null;
  roles: PartyRoleKind[]; // 集約（検索用）
  assigneeUid: string | null;
  storeId: string | null;
  preferences: string | null; // 希望条件
  memo: string | null; // 社内メモ（外部利用者には非表示）
  keywords: string[];
  supportStatus: "none" | "open" | "in_progress" | "done";
}

export type PartyRoleKind =
  | "lessor" | "lessee" | "seller" | "buyer" | "prospect_tenant" | "prospect_buyer"
  | "owner" | "tenant" | "guarantor" | "occupant" | "vendor" | "contact_person" | "other";

export interface PartyRole extends BaseDoc {
  partyId: string;
  role: PartyRoleKind;
  entity: "property" | "unit" | "deal" | "contract";
  entityId: string;
  from: string | null;
  to: string | null;
}

// ───────────── 仲介案件・予定 ─────────────

export interface Deal extends BaseDoc {
  number: string; // D000001
  kind: "rental" | "sale";
  side: "tenant" | "landlord" | "buyer" | "seller" | null; // 売買は売主側/買主側
  title: string;
  customerId: string | null;
  propertyIds: string[];
  unitIds: string[];
  assigneeUid: string | null;
  storeId: string | null;
  status: string; // RENTAL_DEAL_STATUSES / SALE_DEAL_STATUSES
  expectedAmount: number | null;
  nextActionDate: string | null;
  nextAction: string | null;
  contractId: string | null;
  lostReason: string | null;
  conditions: string | null;
  keywords: string[];
}

export interface Activity extends BaseDoc {
  entity: "deal" | "party" | "inquiry" | "repair" | "moveout" | "renewal";
  entityId: string;
  channel: "phone" | "visit" | "email" | "line" | "letter" | "viewing" | "internal" | "portal" | "other";
  direction: "in" | "out" | "none";
  at: string; // ISO
  summary: string;
  body: string | null;
  byUid: string;
}

export interface EventDoc extends BaseDoc {
  title: string;
  type: "viewing" | "meeting" | "inspection" | "move_in" | "move_out" | "settlement" | "construction" | "other";
  start: string; // ISO
  end: string; // ISO
  assigneeUid: string | null;
  partyId: string | null;
  propertyId: string | null;
  unitId: string | null;
  dealId: string | null;
  place: string | null;
  keyPickup: string | null;
  travelMinutes: number | null;
  result: string | null;
  done: boolean;
  storeId: string | null;
}

export interface TaskDoc extends BaseDoc {
  title: string;
  due: string; // YYYY-MM-DD
  assigneeUid: string | null;
  entity: string | null;
  entityId: string | null;
  done: boolean;
  doneBy: string | null;
  doneAt: string | null;
  storeId: string | null;
  sourceKey: string | null; // 自動作成時の重複防止
}

export interface ApplicationDoc extends BaseDoc {
  dealId: string;
  unitId: string | null;
  applicantId: string;
  occupantIds: string[];
  desiredMoveIn: string | null;
  submittedDocs: { name: string; received: boolean; attachmentId: string | null }[];
  guarantorCompany: string | null;
  landlordCheck: "pending" | "ok" | "ng" | null;
  status: "docs_missing" | "reviewing" | "approved" | "rejected" | "withdrawn";
  resultRecordedBy: string | null;
  resultRecordedAt: string | null;
  rejectReason: string | null; // party.sensitive 権限者のみ閲覧
}

// ───────────── 契約 ─────────────

export interface Contract extends BaseDoc {
  number: string; // K000001
  kind: "lease" | "sale" | "brokerage" | "management";
  status: string; // CONTRACT_STATUSES
  title: string;
  unitId: string | null; // 賃貸
  propertyIds: string[]; // 売買: 複数の土地・建物
  dealId: string | null;
  storeId: string | null;
  assigneeUid: string | null;
  currentVersionId: string | null;
  start: string | null;
  end: string | null;
  executedAt: string | null;
  executedBy: string | null;
  executedDocAttachmentId: string | null;
  depositHolder: "company" | "lessor" | "other" | null; // 敷金の実際の保管主体
  overlapException: { reason: string; approvedBy: string; at: string } | null;
  approvals: ApprovalRecord[];
  partyIds: string[]; // 現行版の当事者（外部利用者の閲覧範囲判定・検索用）
  keywords: string[];
}

export interface ApprovalRecord {
  action: "submit" | "approve" | "reject" | "resubmit";
  by: string;
  byName: string;
  at: string;
  reason: string | null;
  versionId: string | null;
}

/** 契約当事者のスナップショット（顧客台帳を後で編集しても変わらない） */
export interface ContractPartySnapshot {
  partyId: string;
  role: "lessor" | "lessee" | "seller" | "buyer" | "guarantor" | "occupant" | "agent";
  type: "person" | "corporation";
  name: string;
  kana: string | null;
  address: string | null;
  phone: string | null;
  share?: string | null;
}

export interface ContractVersion extends BaseDoc {
  contractId: string;
  versionNo: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: "draft" | "confirmed";
  confirmedBy: string | null;
  confirmedAt: string | null;
  parties: ContractPartySnapshot[];
  // 賃貸
  leaseType: "ordinary" | "fixed_term" | null;
  start: string | null;
  end: string | null;
  monthlyItems: MonthlyItem[]; // 月額費用（計算設定を含む: B07 を版へ保存）
  initialItems: { code: string; name: string; amount: number; tax: TaxSetting }[];
  depositAmount: number | null;
  paymentDueDay: number | null; // 毎月の支払期日（例: 27）
  paymentTiming: "prev_month" | "current_month";
  renewal: { termMonths: number | null; fee: number | null; noticeRule: DeadlineRule | null } | null;
  termination: { noticeRule: DeadlineRule | null } | null;
  // 売買
  salePrice: number | null;
  earnestMoney: number | null;
  balanceAmount: number | null;
  contractDate: string | null;
  settlementDate: string | null;
  deliveryDate: string | null;
  loan: { amount: number | null; deadline: string | null; lender: string | null; contingent: boolean } | null;
  // 仲介手数料（B12: 自動適法判定はしない）
  brokerageFee: { method: "rate" | "fixed"; rate: string | null; fixed: number | null; plus: number | null; tax: TaxSetting; billTo: string | null } | null;
  specialTerms: string | null;
  documentsChecked: boolean;
  changeReason: string | null;
  rounding: Rounding;
}

export interface DeadlineRule {
  base: "contract_end" | "custom";
  unit: "days" | "months";
  amount: number;
  holidayAdjust: "none" | "previous_weekday";
}

// ───────────── 書類 ─────────────

export interface TemplateDoc extends BaseDoc {
  docType: string; // invoice, receipt, lease_contract, important_matters ...
  name: string;
  dealType: "rent" | "sale" | "management" | "any";
  versionNo: number;
  effectiveFrom: string;
  approvedBy: string | null;
  approvedAt: string | null;
  status: "draft" | "approved" | "retired";
  body: DocBlock[];
  requiredFields: string[];
}

export type DocBlock =
  | { type: "heading"; text: string; level: 1 | 2 | 3 }
  | { type: "paragraph"; text: string }
  | { type: "table"; columns: string[]; rows: string[][]; source?: string }
  | { type: "image"; attachmentId: string; caption?: string; widthPct?: number }
  | { type: "pagebreak" }
  | { type: "spacer"; height: number };

export interface DocumentDoc extends BaseDoc {
  number: string; // 書類番号
  docType: string;
  title: string;
  entity: string; // contract / invoice / deal / settlement / repair / moveout / renewal
  entityId: string;
  templateId: string | null;
  templateVersionNo: number | null;
  status: "draft" | "in_review" | "approved" | "issued" | "superseded";
  currentVersionId: string | null;
  sourceUpdatedAt: string | null; // 差込み元の更新検知
  publishedTo: ("customer" | "tenant" | "owner" | "vendor")[]; // 外部利用者ページへの公開（発行済みのみ）
  partyIds: string[]; // 公開先の関係者
  keywords: string[];
}

export interface DocumentVersion extends BaseDoc {
  documentId: string;
  versionNo: number;
  data: Record<string, unknown>; // 差込みデータ（作成時の値を固定）
  blocks: DocBlock[]; // 編集内容
  manualEdits: boolean;
  status: "draft" | "in_review" | "approved" | "issued";
  approvedBy: string | null;
  issuedAt: string | null;
  issuedBy: string | null;
  frozen: boolean; // 発行済みは固定
}

// ───────────── 請求・入金 ─────────────

export interface InvoiceLine {
  itemCode: string;
  name: string;
  quantity: string;
  unitPrice: string;
  amount: number;
  tax: TaxSetting;
  period: string | null; // YYYY-MM
  from: string | null;
  to: string | null;
  formula: string | null; // 日割り等の計算根拠
  dedupeKey: string | null;
  contractVersionId: string | null;
  adjustsInvoiceId?: string | null;
}

export interface Invoice extends BaseDoc {
  number: string; // INV-000001
  kind: "monthly" | "initial" | "one_time" | "adjustment" | "cancellation";
  status: "draft" | "confirmed" | "cancelled";
  billToPartyId: string;
  billToName: string;
  contractId: string | null;
  unitId: string | null;
  propertyId: string | null;
  storeId: string | null;
  period: string | null; // YYYY-MM
  issueDate: string;
  dueDate: string | null;
  lines: InvoiceLine[];
  subtotal: number;
  tax: number;
  total: number;
  paid: number; // 配分済み合計（入金配分から更新）
  confirmedAt: string | null;
  confirmedBy: string | null;
  cancelOf: string | null; // 取消・訂正元
  correctedBy: string | null;
  cancelReason: string | null;
  payerKana: string[]; // 照合候補用
  keywords: string[];
}

export interface Payment extends BaseDoc {
  date: string;
  amount: number;
  payerName: string;
  reference: string | null;
  account: string | null;
  source: "manual" | "csv";
  importBatchId: string | null;
  rowNo: number | null;
  fingerprint: string;
  allocated: number;
  unallocatedDisposition: null | { kind: "carry_forward" | "refund"; amount: number; note: string | null; by: string; at: string };
  status: "unallocated" | "partial" | "allocated";
  keywords: string[];
}

export interface Allocation extends BaseDoc {
  paymentId: string;
  invoiceId: string;
  amount: number;
  allocatedAt: string;
  allocatedBy: string;
  reversed: boolean;
  reversedBy: string | null;
  reason: string | null;
  // 精算用
  settlementId: string | null; // 精算済みなら設定（B19: 再利用防止）
  propertyId: string | null;
  contractId: string | null;
  itemBreakdown: { itemCode: string; amount: number }[]; // 費目別の按分
}

export interface ImportBatch extends BaseDoc {
  kind: "payments" | "properties" | "parties";
  fileName: string;
  encoding: string;
  status: "uploaded" | "mapped" | "validated" | "committed" | "failed";
  mapping: Record<string, number>;
  rows: { rowNo: number; raw: string[]; action: "create" | "update" | "skip"; error: string | null; duplicateOf: string[]; resultId: string | null }[];
  committedAt: string | null;
}

// ───────────── 精算・預り金 ─────────────

export interface Settlement extends BaseDoc {
  number: string;
  ownerPartyId: string;
  propertyIds: string[];
  period: string; // YYYY-MM
  status: "calculating" | "review" | "confirmed" | "partially_remitted" | "remitted" | "corrected";
  allocationIds: string[];
  expenses: { name: string; amount: number; repairId: string | null }[];
  carryIn: number;
  calc: {
    collectedTotal: number; feeBase: number; fee: number; feeTax: number; expenses: number; carryIn: number; payable: number; carryOut: number; basis: string[];
  } | null;
  ownerSplit: { ownerId: string; amount: number }[];
  remitted: number;
  confirmedBy: string | null;
  confirmedAt: string | null;
  correctionOf: string | null;
}

export interface Remittance extends BaseDoc {
  settlementId: string;
  ownerPartyId: string;
  date: string;
  amount: number;
  attachmentId: string | null;
  note: string | null;
}

export interface DepositEntryDoc extends BaseDoc {
  contractId: string;
  kind: "receive" | "apply" | "refund_planned" | "refund_executed" | "additional_charge";
  amount: number;
  date: string;
  holder: "company" | "lessor" | "other";
  approved: boolean;
  approvedBy: string | null;
  reason: string | null;
  moveoutId: string | null;
}

// ───────────── 問い合わせ・修繕 ─────────────

export interface Inquiry extends BaseDoc {
  number: string;
  receivedAt: string;
  partyId: string | null;
  partyName: string | null;
  propertyId: string | null;
  unitId: string | null;
  category: "equipment" | "noise" | "leak" | "key" | "contract" | "payment" | "other";
  urgency: "low" | "normal" | "high" | "emergency";
  content: string;
  assigneeUid: string | null;
  due: string | null;
  status: "open" | "in_progress" | "done";
  repairIds: string[];
  storeId: string | null;
  source: "staff" | "portal";
  keywords: string[];
}

export interface Repair extends BaseDoc {
  number: string;
  inquiryId: string | null;
  propertyId: string | null;
  unitId: string | null;
  equipment: string | null;
  symptom: string;
  vendorPartyId: string | null;
  status: string; // REPAIR_STATUSES
  currentEstimateId: string | null;
  approvedEstimateId: string | null;
  scheduledDate: string | null;
  completedAt: string | null;
  completionCheckedBy: string | null;
  billingStatus: "none" | "invoiced" | "paid";
  paymentStatus: "none" | "scheduled" | "paid";
  assigneeUid: string | null;
  storeId: string | null;
  keywords: string[];
}

export interface Estimate extends BaseDoc {
  repairId: string;
  versionNo: number;
  previousId: string | null;
  reason: string | null; // 追加・変更理由
  lines: {
    name: string; quantity: string; unit: string; unitPrice: string; amount: number; tax: TaxSetting;
    burden: { party: "lessor" | "lessee" | "company" | "other"; amount: number }[];
  }[];
  subtotal: number;
  tax: number;
  total: number;
  status: "draft" | "submitted" | "approved" | "rejected" | "superseded";
  approvals: ApprovalRecord[];
  externalApproval: { partyId: string; answer: "approve" | "reject"; at: string; versionNo: number; comment: string | null } | null;
}

// ───────────── 更新・退去 ─────────────

export interface Renewal extends BaseDoc {
  contractId: string;
  unitId: string | null;
  expiresOn: string;
  noticeDeadline: string | null;
  proposedTerms: { rent: number | null; fee: number | null; termMonths: number | null; note: string | null } | null;
  answer: "pending" | "accept" | "decline" | "negotiating";
  status: "extracted" | "notified" | "answered" | "documents" | "completed" | "cancelled";
  newVersionId: string | null;
  invoiceId: string | null;
  sourceKey: string; // 自動抽出の重複防止
}

export interface Moveout extends BaseDoc {
  contractId: string;
  unitId: string | null;
  requestedAt: string;
  desiredDate: string | null;
  confirmedDate: string | null;
  inspectionAt: string | null;
  keysReturned: number | null;
  status: string; // MOVEOUT_STATUSES
  finalInvoiceId: string | null;
  repairIds: string[];
  burdenDecisions: { item: string; party: string; amount: number; reason: string; checkedBy: string }[];
  impactNote: string | null;
}

// ───────────── その他 ─────────────

export interface ShareLink extends BaseDoc {
  token: string; // ハッシュではなく推測困難なランダム値の SHA-256 を docId に使う
  purpose: "proposal_view" | "doc_submit";
  entity: string;
  entityId: string;
  expiresAt: string;
  revoked: boolean;
  requiresLogin: boolean;
}

export interface JobRun extends BaseDoc {
  job: "monthly_billing" | "deadline_extract" | "notifications";
  key: string; // 例: monthly_billing:2026-11
  status: "running" | "succeeded" | "failed";
  startedAt: string;
  finishedAt: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
  retryOf: string | null;
}
