// 問い合わせ・修繕・外部利用者ページ・設定のラベルと純粋関数（サーバー/クライアント/テスト共通）。
// テストから読み込むため、実行時の import は相対パスの純粋モジュールのみとする。
import Decimal from "decimal.js";
import type { Tone } from "@/components/ui";
import { computeTotals, roundYen, type Rounding, type TaxSetting } from "./domain/money";
import { addDays } from "./domain/dates";
import type { Repair, Estimate } from "./types";

type L = Record<string, { label: string; tone?: Tone }>;

export const INQUIRY_STATUS: L = {
  open: { label: "未対応", tone: "warn" },
  in_progress: { label: "対応中", tone: "info" },
  done: { label: "完了", tone: "ok" },
};

export const INQUIRY_CATEGORY: L = {
  equipment: { label: "設備" },
  noise: { label: "騒音" },
  leak: { label: "漏水" },
  key: { label: "鍵" },
  contract: { label: "契約" },
  payment: { label: "支払" },
  other: { label: "その他" },
};

export const URGENCY: L = {
  low: { label: "低", tone: "neutral" },
  normal: { label: "通常", tone: "neutral" },
  high: { label: "高", tone: "warn" },
  emergency: { label: "緊急", tone: "danger" },
};

export const INQUIRY_SOURCE: L = {
  staff: { label: "社内受付" },
  portal: { label: "外部利用者ページ" },
};

export const ACTIVITY_CHANNEL: L = {
  phone: { label: "電話" },
  visit: { label: "来店・訪問" },
  email: { label: "メール" },
  line: { label: "LINE" },
  letter: { label: "書面" },
  viewing: { label: "内見" },
  internal: { label: "社内メモ" },
  portal: { label: "外部利用者ページ" },
  other: { label: "その他" },
};

export const ACTIVITY_DIRECTION: L = {
  in: { label: "受信" },
  out: { label: "発信" },
  none: { label: "—" },
};

export const REPAIR_STATUS: L = {
  received: { label: "受付", tone: "neutral" },
  site_check: { label: "現地確認", tone: "info" },
  awaiting_estimate: { label: "見積待ち", tone: "info" },
  awaiting_approval: { label: "承認待ち", tone: "warn" },
  ordered: { label: "発注記録済み", tone: "info" },
  in_progress: { label: "施工中", tone: "info" },
  awaiting_completion_check: { label: "完了確認待ち", tone: "warn" },
  completed: { label: "完了", tone: "ok" },
  cancelled: { label: "中止", tone: "neutral" },
};

export const ESTIMATE_STATUS: L = {
  draft: { label: "下書き", tone: "neutral" },
  submitted: { label: "承認待ち", tone: "warn" },
  approved: { label: "承認済み", tone: "ok" },
  rejected: { label: "差戻し", tone: "danger" },
  superseded: { label: "旧版（変更版あり）", tone: "neutral" },
};

export const BURDEN_PARTY: L = {
  lessor: { label: "貸主" },
  lessee: { label: "借主" },
  company: { label: "自社" },
  other: { label: "その他" },
};

export const REPAIR_BILLING: L = {
  none: { label: "未請求", tone: "neutral" },
  invoiced: { label: "請求済み", tone: "info" },
  paid: { label: "入金済み", tone: "ok" },
};

export const REPAIR_PAYMENT: L = {
  none: { label: "未払い", tone: "neutral" },
  scheduled: { label: "支払予定", tone: "info" },
  paid: { label: "支払済み", tone: "ok" },
};

export const REACTION: L = {
  interested: { label: "気になる", tone: "info" },
  viewing_request: { label: "内見希望", tone: "ok" },
  declined: { label: "見送り", tone: "neutral" },
};

export const REPAIR_PHOTO_CATEGORIES = ["工事写真（前）", "工事写真（後）", "工事写真（施工中）", "見積書", "報告書", "請求書", "その他"];

export const DEFAULT_ATTACHMENT_CATEGORIES = [
  "外観", "室内", "間取り", "設備", "周辺", "図面", "契約書", "重要事項説明", "本人確認", "見積書",
  "工事写真（前）", "工事写真（後）", "報告書", "提出資料", "その他",
];

// ───────────── 修繕の状態遷移 ─────────────

/**
 * 手動で変更できる遷移先。承認待ちは見積の承認申請、完了は完了確認でのみ設定する。
 * 発注記録は「現行見積が承認済み」であることを別途サーバーで確認する。
 */
const REPAIR_MANUAL_NEXT: Record<string, string[]> = {
  received: ["site_check", "awaiting_estimate", "cancelled"],
  site_check: ["awaiting_estimate", "received", "cancelled"],
  awaiting_estimate: ["site_check", "cancelled"],
  awaiting_approval: ["awaiting_estimate", "ordered", "cancelled"],
  ordered: ["in_progress", "cancelled"],
  in_progress: ["awaiting_completion_check", "ordered"],
  awaiting_completion_check: ["in_progress"],
  completed: [],
  cancelled: ["received"],
};

export function nextRepairStatuses(status: string): string[] {
  return REPAIR_MANUAL_NEXT[status] ?? [];
}

export function validateRepairTransition(
  from: string,
  to: string,
  r: { currentEstimateStatus: string | null; reason: string | null },
): string[] {
  const e: string[] = [];
  if (!nextRepairStatuses(from).includes(to)) e.push(`「${REPAIR_STATUS[from]?.label ?? from}」から「${REPAIR_STATUS[to]?.label ?? to}」へは変更できません`);
  if (to === "ordered" && r.currentEstimateStatus !== "approved") e.push("発注を記録するには、現行の見積が承認済みである必要があります");
  if (to === "cancelled" && !r.reason) e.push("中止の理由を入力してください");
  return e;
}

// ───────────── 見積（B22/B23） ─────────────

export interface EstimateLineInput {
  name: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  tax: TaxSetting;
  burden: { party: "lessor" | "lessee" | "company" | "other"; amount: number }[];
}

export const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

/** 明細金額と合計を計算する（税率別に集計してから税を計算: B11） */
export function computeEstimate(lines: EstimateLineInput[], lineRounding: Rounding, taxRounding: Rounding) {
  const withAmount = lines.map((l) => {
    const ok = DECIMAL_RE.test(l.quantity) && DECIMAL_RE.test(l.unitPrice);
    const amount = ok ? roundYen(new Decimal(l.quantity).mul(l.unitPrice), lineRounding) : 0;
    const burdenTotal = l.burden.reduce((s, b) => s + (Number.isFinite(b.amount) ? b.amount : 0), 0);
    return { ...l, amount, burdenTotal, burdenMatches: ok && burdenTotal === amount };
  });
  const totals = computeTotals(withAmount.map((l) => ({ amount: l.amount, tax: l.tax })), taxRounding);
  const burdenByParty: Record<string, number> = {};
  for (const l of withAmount) for (const b of l.burden) burdenByParty[b.party] = (burdenByParty[b.party] ?? 0) + (b.amount || 0);
  return { lines: withAmount, subtotal: totals.subtotalExclTax, tax: totals.tax, total: totals.total, breakdown: totals.breakdown, burdenByParty };
}

/** 入力値の検証（下書き保存時）。承認申請時はこれに加えて validateEstimateBurden を満たす必要がある */
export function validateEstimateLines(lines: EstimateLineInput[]): string[] {
  const e: string[] = [];
  lines.forEach((l, i) => {
    const n = `${i + 1}行目`;
    if (!l.name.trim()) e.push(`${n}: 項目名を入力してください`);
    if (!DECIMAL_RE.test(l.quantity)) e.push(`${n}: 数量は数値で入力してください`);
    if (!DECIMAL_RE.test(l.unitPrice)) e.push(`${n}: 単価は数値で入力してください`);
    if (!["taxable", "exempt", "non_taxable"].includes(l.tax.category)) e.push(`${n}: 税区分が不正です`);
    if (l.tax.category === "taxable" && !DECIMAL_RE.test(l.tax.rate)) e.push(`${n}: 税率が不正です`);
    for (const b of l.burden) {
      if (!Number.isInteger(b.amount)) e.push(`${n}: 負担額は円単位の整数で入力してください`);
      if (!["lessor", "lessee", "company", "other"].includes(b.party)) e.push(`${n}: 負担者が不正です`);
    }
  });
  return e;
}

/** 変更版と前版の比較（B23: 変更前後の差額と理由を表示） */
export function estimateDiff(
  prev: { lines: { name: string; amount: number }[]; total: number } | null,
  next: { lines: { name: string; amount: number }[]; total: number },
) {
  if (!prev) return { totalDiff: next.total, added: next.lines.map((l) => l.name), removed: [] as string[], changed: [] as { name: string; before: number; after: number }[] };
  const before = new Map<string, number>();
  for (const l of prev.lines) before.set(l.name, (before.get(l.name) ?? 0) + l.amount);
  const after = new Map<string, number>();
  for (const l of next.lines) after.set(l.name, (after.get(l.name) ?? 0) + l.amount);
  const added = [...after.keys()].filter((k) => !before.has(k));
  const removed = [...before.keys()].filter((k) => !after.has(k));
  const changed = [...after.keys()]
    .filter((k) => before.has(k) && before.get(k) !== after.get(k))
    .map((k) => ({ name: k, before: before.get(k)!, after: after.get(k)! }));
  return { totalDiff: next.total - prev.total, added, removed, changed };
}

// ───────────── 期限・状態の算出 ─────────────

export function isInquiryOverdue(i: { due: string | null; status: string }, today: string): boolean {
  return !!i.due && i.status !== "done" && i.due < today;
}

/** 更新案内期限が today〜today+days の範囲（期限当日を含む） */
export function noticeDeadlineSoon(noticeDeadline: string | null, today: string, days = 14): boolean {
  if (!noticeDeadline) return false;
  return noticeDeadline >= today && noticeDeadline <= addDays(today, days);
}

export type InviteState = "used" | "revoked" | "expired" | "active";
export function inviteState(c: { usedBy?: string | null; revoked?: boolean; expiresAt: string }, nowIso: string): InviteState {
  if (c.usedBy) return "used";
  if (c.revoked) return "revoked";
  if (c.expiresAt < nowIso) return "expired";
  return "active";
}
export const INVITE_STATE: L = {
  used: { label: "使用済み", tone: "ok" },
  revoked: { label: "無効化", tone: "neutral" },
  expired: { label: "期限切れ", tone: "neutral" },
  active: { label: "未使用（有効）", tone: "info" },
};

// ───────────── 共有リンク ─────────────

/**
 * リンクだけで閲覧できる対象は提案（物件比較）のみ。
 * 契約・精算・本人確認資料・書類は利用者認証が必要なため、共有リンクを作成できない。
 */
export const SHAREABLE: Record<string, string[]> = { proposal_view: ["proposal"] };

export function isShareable(purpose: string, entity: string): boolean {
  return (SHAREABLE[purpose] ?? []).includes(entity);
}

export type ShareState = "active" | "expired" | "revoked";
export function shareLinkState(l: { revoked: boolean; expiresAt: string }, nowIso: string): ShareState {
  if (l.revoked) return "revoked";
  if (l.expiresAt <= nowIso) return "expired";
  return "active";
}

/** 共有トークン: `${companyId}.${ランダム値}`。保存するのは SHA-256 のみ */
export function parseShareToken(token: string): { companyId: string } | null {
  const m = /^([A-Za-z0-9]{1,64})\.([A-Za-z0-9_-]{32,})$/.exec(token);
  return m ? { companyId: m[1] } : null;
}

// ───────────── 設定の適用開始日 ─────────────

/** 適用開始日が date 以前の履歴のうち最新のもの（S25: 過去の確定計算は変えない） */
export function effectiveAt<T extends { effectiveFrom: string; at?: string }>(history: T[], date: string): T | null {
  const c = history.filter((h) => h.effectiveFrom <= date);
  c.sort((a, b) => (a.effectiveFrom === b.effectiveFrom ? (a.at ?? "").localeCompare(b.at ?? "") : a.effectiveFrom.localeCompare(b.effectiveFrom)));
  return c[c.length - 1] ?? null;
}

// ───────────── 集計 ─────────────

/** 業務日付の範囲 [from, to] を ISO 日時範囲 [start, endExclusive) に変換（日本時間） */
export function jstDayRangeIso(from: string, to: string): { start: string; end: string } {
  return { start: new Date(`${from}T00:00:00+09:00`).toISOString(), end: new Date(`${addDays(to, 1)}T00:00:00+09:00`).toISOString() };
}

export function remainingOf(inv: { total: number; paid: number }): number {
  return Math.max(0, (inv.total ?? 0) - (inv.paid ?? 0));
}

export const HOME_SCOPES = ["mine", "store", "company"] as const;
export type HomeScope = (typeof HOME_SCOPES)[number];
export function parseScope(v: unknown, def: HomeScope = "mine"): HomeScope {
  return HOME_SCOPES.includes(v as HomeScope) ? (v as HomeScope) : def;
}

export function opts(l: L) {
  return Object.entries(l).map(([value, v]) => ({ value, label: v.label }));
}
export function lbl(l: L, key: string | null | undefined): string {
  if (!key) return "—";
  return l[key]?.label ?? key;
}
export function tone(l: L, key: string | null | undefined): Tone {
  return (key && l[key]?.tone) || "neutral";
}

// ───────────── 本モジュールで追加保存する項目（共通型の拡張） ─────────────
export interface RepairExt extends Repair {
  /** 見積承認の状態（none: 見積なし/下書き, pending: 承認待ち, approved, rejected） */
  approvalState?: "none" | "pending" | "approved" | "rejected";
  orderedAt?: string | null;
  orderedBy?: string | null;
  completedNote?: string | null;
  cancelReason?: string | null;
  billingNote?: string | null;
  invoiceId?: string | null;
  vendorBillAmount?: number | null;
  vendorPaidOn?: string | null;
}

export interface EstimateExt extends Estimate {
  ownerApprovalRequested?: boolean;
  ownerPartyIds?: string[];
  submittedByVendor?: boolean;
  externalApprovalAuthTime?: number | null;
}
