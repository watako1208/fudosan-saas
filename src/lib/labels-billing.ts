import type { Tone } from "@/components/ui";

type L = Record<string, { label: string; tone?: Tone }>;

export const INVOICE_STATUS: L = {
  draft: { label: "下書き", tone: "neutral" },
  confirmed: { label: "確定", tone: "info" },
  cancelled: { label: "取消", tone: "neutral" },
};

export const INVOICE_KIND: L = {
  monthly: { label: "月額" },
  initial: { label: "初期費用" },
  one_time: { label: "一時" },
  adjustment: { label: "差額調整" },
  cancellation: { label: "取消記録" },
};

/** 入金状態（配分と期限から算出。自由入力しない）。赤は期限超過のみ */
export const PAYMENT_STATE: L = {
  unpaid: { label: "未入金", tone: "neutral" },
  partial: { label: "一部入金", tone: "info" },
  paid: { label: "入金済み", tone: "ok" },
  overdue: { label: "期限超過", tone: "danger" },
  "n/a": { label: "—", tone: "neutral" },
};

export const PAYMENT_STATUS: L = {
  unallocated: { label: "未配分", tone: "neutral" },
  partial: { label: "一部配分", tone: "info" },
  allocated: { label: "配分済み", tone: "ok" },
};

export const PAYMENT_SOURCE: L = {
  manual: { label: "手入力" },
  csv: { label: "CSV取込み" },
};

export const DISPOSITION: L = {
  carry_forward: { label: "次月充当" },
  refund: { label: "返金" },
};

export const SETTLEMENT_STATUS: L = {
  calculating: { label: "計算中", tone: "neutral" },
  review: { label: "確認待ち", tone: "warn" },
  confirmed: { label: "確定（送金未記録）", tone: "info" },
  partially_remitted: { label: "送金一部記録済み", tone: "info" },
  remitted: { label: "送金記録済み", tone: "ok" },
  corrected: { label: "訂正済み", tone: "neutral" },
};

export const IMPORT_STATUS: L = {
  uploaded: { label: "列対応待ち", tone: "warn" },
  mapped: { label: "列対応済み", tone: "neutral" },
  validated: { label: "取込予定確認中", tone: "warn" },
  committed: { label: "取込完了", tone: "ok" },
  failed: { label: "取込失敗", tone: "danger" },
};

export const JOB_STATUS: L = {
  running: { label: "実行中", tone: "info" },
  succeeded: { label: "成功", tone: "ok" },
  failed: { label: "失敗", tone: "danger" },
};

export const JOB_NAME: L = {
  monthly_billing: { label: "月次請求作成" },
  deadline_extract: { label: "更新・期限抽出" },
  notifications: { label: "期限通知作成" },
};

export const TAX_CATEGORY: L = {
  taxable: { label: "課税" },
  exempt: { label: "非課税" },
  non_taxable: { label: "不課税" },
};
