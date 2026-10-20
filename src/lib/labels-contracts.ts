import type { Tone } from "@/components/ui";

// 契約・更新・退去・預り金の表示ラベル（labels.ts と同じ形式）
type L = Record<string, { label: string; tone?: Tone }>;

export const CONTRACT_KIND: L = {
  lease: { label: "賃貸借" },
  sale: { label: "売買" },
  brokerage: { label: "媒介" },
  management: { label: "管理委託" },
};

/** 契約状態。黄=確認待ち、赤=エラーに限定する */
export const CONTRACT_STATUS: L = {
  draft: { label: "下書き", tone: "neutral" },
  in_review: { label: "社内確認中", tone: "warn" },
  approved: { label: "承認済み", tone: "info" },
  executed: { label: "締結記録済み", tone: "ok" },
  active: { label: "契約期間中", tone: "ok" },
  ended: { label: "終了", tone: "neutral" },
  cancelled: { label: "取消", tone: "neutral" },
};

export const VERSION_STATUS: L = {
  draft: { label: "未確定", tone: "warn" },
  confirmed: { label: "確定", tone: "ok" },
};

export const LEASE_TYPE: L = {
  ordinary: { label: "普通借家" },
  fixed_term: { label: "定期借家" },
};

export const CONTRACT_PARTY_ROLE: L = {
  lessor: { label: "貸主" },
  lessee: { label: "借主" },
  guarantor: { label: "連帯保証人" },
  occupant: { label: "入居者・同居人" },
  seller: { label: "売主" },
  buyer: { label: "買主" },
  agent: { label: "代理人" },
};

export const LEASE_PARTY_ROLES = ["lessor", "lessee", "guarantor", "occupant"] as const;
export const SALE_PARTY_ROLES = ["seller", "buyer", "agent"] as const;

export const PAYMENT_TIMING: L = {
  prev_month: { label: "前月払い（翌月分を当月に支払う）" },
  current_month: { label: "当月払い" },
};

export const DEPOSIT_HOLDER: L = {
  company: { label: "自社（管理会社）が保管" },
  lessor: { label: "貸主が保管" },
  other: { label: "その他（保証会社等）が保管" },
};

export const DEPOSIT_HOLDER_SHORT: L = {
  company: { label: "自社保管" },
  lessor: { label: "貸主保管" },
  other: { label: "その他保管" },
};

export const DEPOSIT_KIND: L = {
  receive: { label: "受入" },
  apply: { label: "充当（原状回復等）" },
  refund_planned: { label: "返金予定" },
  refund_executed: { label: "返金実行" },
  additional_charge: { label: "追加請求（不足分）" },
};

export const PRORATION_METHOD: L = {
  actual: { label: "実日数方式（対象日数÷当月日数）" },
  fixed30: { label: "30日固定方式" },
  none: { label: "日割りなし" },
};

export const ROUNDING: L = {
  floor: { label: "切捨て" },
  round: { label: "四捨五入" },
  ceil: { label: "切上げ" },
};

export const FIXED30_COUNTING: L = {
  calendar_cap30: { label: "暦日数（上限30日）" },
  month_end_as_30: { label: "月末までの場合は30日とみなす" },
};

export const TAX_CATEGORY: L = {
  taxable: { label: "課税" },
  exempt: { label: "非課税" },
  non_taxable: { label: "不課税" },
};

export const PRICE_MODE: L = {
  exclusive: { label: "税抜" },
  inclusive: { label: "税込" },
};

export const DEADLINE_UNIT: L = {
  months: { label: "か月前" },
  days: { label: "日前" },
};

export const HOLIDAY_ADJUST: L = {
  none: { label: "調整しない" },
  previous_weekday: { label: "土日の場合は前営業日" },
};

export const BROKERAGE_METHOD: L = {
  rate: { label: "料率" },
  fixed: { label: "定額" },
};

export const APPROVAL_ACTION: L = {
  submit: { label: "社内確認へ提出", tone: "info" },
  resubmit: { label: "再提出", tone: "info" },
  approve: { label: "社内承認", tone: "ok" },
  reject: { label: "差戻し", tone: "warn" },
};

export const RENEWAL_STATUS: L = {
  extracted: { label: "抽出済み（未案内）", tone: "warn" },
  notified: { label: "案内済み", tone: "info" },
  answered: { label: "回答あり", tone: "info" },
  documents: { label: "書類手続き中", tone: "info" },
  completed: { label: "更新確定", tone: "ok" },
  cancelled: { label: "対象外・中止", tone: "neutral" },
};

export const RENEWAL_STEPS = ["extracted", "notified", "answered", "documents", "completed"] as const;

export const RENEWAL_ANSWER: L = {
  pending: { label: "未回答", tone: "warn" },
  accept: { label: "更新する", tone: "ok" },
  decline: { label: "更新しない（解約）", tone: "neutral" },
  negotiating: { label: "条件交渉中", tone: "info" },
};

export const MOVEOUT_STATUS: L = {
  requested: { label: "申出受付", tone: "warn" },
  checking: { label: "条件確認", tone: "info" },
  date_fixed: { label: "解約日確定", tone: "info" },
  inspection_scheduled: { label: "立会い予定", tone: "info" },
  vacated: { label: "退去確認済み", tone: "info" },
  settlement_prep: { label: "精算準備", tone: "info" },
  settlement_checked: { label: "精算確認済み", tone: "info" },
  awaiting_refund: { label: "返金・回収待ち", tone: "warn" },
  completed: { label: "完了", tone: "ok" },
};

export const BURDEN_PARTY: L = {
  lessee: { label: "借主負担" },
  lessor: { label: "貸主負担" },
  company: { label: "自社負担" },
  other: { label: "その他" },
};
