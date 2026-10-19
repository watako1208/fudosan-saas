// 権限モデル。画面の表示制御とサーバー側の権限確認の両方でこの定義を使う。

export type StaffRole = "admin" | "store_manager" | "sales" | "contract_clerk" | "accounting" | "repair";
export type ExternalKind = "customer" | "tenant" | "owner" | "vendor";

export const ROLE_LABEL: Record<StaffRole, string> = {
  admin: "会社管理者",
  store_manager: "店舗責任者",
  sales: "営業担当",
  contract_clerk: "契約事務担当",
  accounting: "管理・経理担当",
  repair: "修繕担当",
};

export const EXTERNAL_LABEL: Record<ExternalKind, string> = {
  customer: "顧客",
  tenant: "入居者",
  owner: "オーナー",
  vendor: "工事業者",
};

export type Cap =
  | "property.read" | "property.write"
  | "party.read" | "party.write" | "party.sensitive" // sensitive=本人確認資料・審査否決理由
  | "deal.read" | "deal.write"
  | "schedule.read" | "schedule.write"
  | "contract.read" | "contract.write" | "contract.approve"
  | "document.read" | "document.write" | "document.approve" | "template.manage"
  | "billing.read" | "billing.write" | "billing.confirm"
  | "payment.read" | "payment.write" | "payment.confirm"
  | "settlement.read" | "settlement.write" | "settlement.confirm"
  | "repair.read" | "repair.write" | "repair.approve"
  | "lease.read" | "lease.write" // 更新・退去
  | "report.read"
  | "settings.manage" | "period.unlock" | "data.export" | "audit.read"
  | "assignee.change";

const ALL_READ: Cap[] = [
  "property.read", "party.read", "deal.read", "schedule.read", "contract.read", "document.read",
  "billing.read", "payment.read", "settlement.read", "repair.read", "lease.read", "report.read",
];

export const ROLE_CAPS: Record<StaffRole, Cap[]> = {
  admin: [
    ...ALL_READ, "property.write", "party.write", "party.sensitive", "deal.write", "schedule.write",
    "contract.write", "contract.approve", "document.write", "document.approve", "template.manage",
    "billing.write", "billing.confirm", "payment.write", "payment.confirm", "settlement.write", "settlement.confirm",
    "repair.write", "repair.approve", "lease.write", "settings.manage", "period.unlock", "data.export", "audit.read",
    "assignee.change",
  ],
  store_manager: [
    ...ALL_READ, "property.write", "party.write", "party.sensitive", "deal.write", "schedule.write",
    "contract.write", "contract.approve", "document.write", "document.approve", "repair.write", "repair.approve",
    "lease.write", "data.export", "assignee.change",
  ],
  sales: [
    "property.read", "property.write", "party.read", "party.write", "deal.read", "deal.write",
    "schedule.read", "schedule.write", "contract.read", "document.read", "document.write", "repair.read", "report.read",
  ],
  contract_clerk: [
    "property.read", "party.read", "party.sensitive", "deal.read", "schedule.read", "schedule.write",
    "contract.read", "contract.write", "document.read", "document.write", "lease.read", "lease.write", "billing.read",
  ],
  accounting: [
    "property.read", "party.read", "contract.read", "document.read", "document.write", "schedule.read",
    "billing.read", "billing.write", "payment.read", "payment.write", "settlement.read", "settlement.write",
    "lease.read", "lease.write", "repair.read", "report.read",
  ],
  repair: [
    "property.read", "party.read", "schedule.read", "schedule.write", "repair.read", "repair.write", "document.read",
    "document.write", "lease.read",
  ],
};

/** 権限の追加付与（例: 経理担当に入金確定を付与） */
export const GRANTABLE_CAPS: Cap[] = [
  "billing.confirm", "payment.confirm", "settlement.confirm", "contract.approve", "document.approve",
  "repair.approve", "party.sensitive", "data.export",
];

export function capsOf(roles: StaffRole[], extra: Cap[] = []): Set<Cap> {
  const s = new Set<Cap>(extra);
  for (const r of roles) for (const c of ROLE_CAPS[r] ?? []) s.add(c);
  return s;
}

export interface NavItem {
  href: string;
  label: string;
  cap?: Cap;
  icon: string;
}

export const NAV: NavItem[] = [
  { href: "/home", label: "ホーム", icon: "home" },
  { href: "/properties", label: "物件", cap: "property.read", icon: "building" },
  { href: "/parties", label: "顧客", cap: "party.read", icon: "users" },
  { href: "/deals", label: "仲介案件", cap: "deal.read", icon: "briefcase" },
  { href: "/schedule", label: "予定", cap: "schedule.read", icon: "calendar" },
  { href: "/contracts", label: "契約", cap: "contract.read", icon: "file-signature" },
  { href: "/documents", label: "書類", cap: "document.read", icon: "file" },
  { href: "/billing", label: "請求・入金", cap: "billing.read", icon: "yen" },
  { href: "/settlements", label: "オーナー精算", cap: "settlement.read", icon: "wallet" },
  { href: "/support", label: "問い合わせ・修繕", cap: "repair.read", icon: "wrench" },
  { href: "/lease", label: "更新・退去", cap: "lease.read", icon: "refresh" },
  { href: "/reports", label: "集計", cap: "report.read", icon: "chart" },
  { href: "/settings", label: "設定", cap: "settings.manage", icon: "gear" },
];
