// 顧客・仲介案件・予定・申込みのラベル（形式は src/lib/labels.ts と同じ）
import type { Tone } from "@/components/ui";
import { RENTAL_DEAL_STATUSES, SALE_DEAL_STATUSES } from "@/lib/domain/rules";

type L = Record<string, { label: string; tone?: Tone }>;

export const PARTY_TYPE: L = {
  person: { label: "個人" },
  corporation: { label: "法人" },
};

/** 対応状態（色だけでなく文字で表示） */
export const SUPPORT_STATUS: L = {
  open: { label: "未対応", tone: "warn" },
  in_progress: { label: "対応中", tone: "info" },
  done: { label: "完了", tone: "ok" },
  none: { label: "対応不要", tone: "neutral" },
};

export const DEAL_KIND: L = {
  rental: { label: "賃貸" },
  sale: { label: "売買" },
};

export const DEAL_SIDE: L = {
  tenant: { label: "借主側" },
  landlord: { label: "貸主側" },
  buyer: { label: "買主側" },
  seller: { label: "売主側" },
};

export const ACTIVITY_CHANNEL: L = {
  phone: { label: "電話" },
  visit: { label: "来店・訪問" },
  email: { label: "メール（外部で送受信）" },
  line: { label: "LINE（外部で送受信）" },
  letter: { label: "郵送" },
  viewing: { label: "内見" },
  internal: { label: "社内メモ" },
  portal: { label: "共有ページ" },
  other: { label: "その他" },
};

export const ACTIVITY_DIRECTION: L = {
  in: { label: "受信・来訪" },
  out: { label: "発信・訪問" },
  none: { label: "—" },
};

export const EVENT_TYPE: L = {
  viewing: { label: "内見" },
  meeting: { label: "打合せ" },
  inspection: { label: "立会い・点検" },
  move_in: { label: "入居" },
  move_out: { label: "退去" },
  settlement: { label: "決済" },
  construction: { label: "工事" },
  other: { label: "その他" },
};

export const APPLICATION_STATUS: L = {
  docs_missing: { label: "書類不足", tone: "warn" },
  reviewing: { label: "確認中", tone: "warn" },
  approved: { label: "承認", tone: "ok" },
  rejected: { label: "否決", tone: "neutral" },
  withdrawn: { label: "取下げ", tone: "neutral" },
};

export const LANDLORD_CHECK: L = {
  pending: { label: "確認待ち", tone: "warn" },
  ok: { label: "了承", tone: "ok" },
  ng: { label: "不可", tone: "neutral" },
};

export const REACTION_KIND: L = {
  interested: { label: "気になる", tone: "info" },
  viewing_request: { label: "内見希望", tone: "warn" },
  declined: { label: "見送り", tone: "neutral" },
};

export const ROLE_ENTITY: L = {
  property: { label: "物件" },
  unit: { label: "部屋・区画" },
  deal: { label: "仲介案件" },
  contract: { label: "契約" },
};

export function dealStatuses(kind: string) {
  return kind === "sale" ? SALE_DEAL_STATUSES : RENTAL_DEAL_STATUSES;
}

/** 案件状態の色（終了系は neutral、成約は ok、申込・契約準備は warn） */
export function dealStatusTone(status: string): Tone {
  if (["won", "contracted", "delivered"].includes(status)) return "ok";
  if (["lost", "closed", "on_hold"].includes(status)) return "neutral";
  if (["applied", "contract_prep", "purchase_application", "negotiation", "settlement_prep"].includes(status)) return "warn";
  return "info";
}

/** 契約準備の必要書類（タスクとして作成） */
export const REQUIRED_DOCS: Record<"rental" | "sale", string[]> = {
  rental: ["入居申込書", "本人確認書類", "収入証明書類", "住民票", "保証会社の審査結果（外部で実施・結果記録）", "重要事項説明書の作成・確認", "賃貸借契約書の作成・確認", "初期費用明細の確認"],
  sale: ["本人確認書類", "印鑑証明書", "住民票", "登記事項証明書", "重要事項説明書の作成・確認", "売買契約書の作成・確認", "融資承認書類（融資利用時）", "決済準備（必要書類の確認）"],
};
