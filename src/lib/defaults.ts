import type { TaxSetting, ProrationSetting } from "@/lib/domain/money";

// 初期費目。B10: 費目ごとに税区分を持つ（「賃貸だから一律非課税」としない）。
// 会社設定で変更可能。変更は適用開始日付きで新しい設定として保存する（B25/S25）。

export interface ItemType {
  code: string;
  name: string;
  kind: "monthly" | "initial" | "one_time" | "deposit";
  tax: TaxSetting;
  proration: ProrationSetting;
  /** 管理料の算定対象に含めるか（B18） */
  managementFeeTarget: boolean;
  /** 家賃収入とは区別する預り金か（B21） */
  isDeposit: boolean;
  sort: number;
}

const ex = { category: "exempt", rate: "0", priceMode: "exclusive" } as const;
const t10 = { category: "taxable", rate: "0.10", priceMode: "exclusive" } as const;
const t10in = { category: "taxable", rate: "0.10", priceMode: "inclusive" } as const;
const nt = { category: "non_taxable", rate: "0", priceMode: "exclusive" } as const;
const actual = { method: "actual", rounding: "floor" } as const;
const none = { method: "none", rounding: "floor" } as const;

export const DEFAULT_ITEM_TYPES: ItemType[] = [
  { code: "rent", name: "賃料（住宅）", kind: "monthly", tax: ex, proration: actual, managementFeeTarget: true, isDeposit: false, sort: 10 },
  { code: "common_fee", name: "共益費・管理費（住宅）", kind: "monthly", tax: ex, proration: actual, managementFeeTarget: false, isDeposit: false, sort: 20 },
  { code: "parking", name: "駐車場使用料", kind: "monthly", tax: t10in, proration: actual, managementFeeTarget: true, isDeposit: false, sort: 30 },
  { code: "rent_commercial", name: "賃料（店舗・事務所）", kind: "monthly", tax: t10, proration: actual, managementFeeTarget: true, isDeposit: false, sort: 40 },
  { code: "water", name: "水道料（定額）", kind: "monthly", tax: t10in, proration: none, managementFeeTarget: false, isDeposit: false, sort: 50 },
  { code: "key_money", name: "礼金（住宅）", kind: "initial", tax: ex, proration: none, managementFeeTarget: false, isDeposit: false, sort: 100 },
  { code: "security_deposit", name: "敷金", kind: "deposit", tax: nt, proration: none, managementFeeTarget: false, isDeposit: true, sort: 110 },
  { code: "brokerage_fee", name: "仲介手数料", kind: "initial", tax: t10, proration: none, managementFeeTarget: false, isDeposit: false, sort: 120 },
  { code: "guarantee_fee", name: "保証料（立替）", kind: "initial", tax: nt, proration: none, managementFeeTarget: false, isDeposit: false, sort: 130 },
  { code: "key_exchange", name: "鍵交換費用", kind: "initial", tax: t10, proration: none, managementFeeTarget: false, isDeposit: false, sort: 140 },
  { code: "renewal_fee", name: "更新料（住宅）", kind: "one_time", tax: ex, proration: none, managementFeeTarget: false, isDeposit: false, sort: 200 },
  { code: "restoration", name: "原状回復費用", kind: "one_time", tax: t10, proration: none, managementFeeTarget: false, isDeposit: false, sort: 210 },
  { code: "other_taxable", name: "その他（課税）", kind: "one_time", tax: t10, proration: none, managementFeeTarget: false, isDeposit: false, sort: 900 },
  { code: "other_exempt", name: "その他（非課税）", kind: "one_time", tax: ex, proration: none, managementFeeTarget: false, isDeposit: false, sort: 910 },
];

export function defaultCompanySettings() {
  return {
    taxRounding: "floor",
    lineRounding: "floor",
    defaultProration: { method: "actual", rounding: "floor" },
    fileMaxMB: 30,
    fileMaxCount: 50,
    closedThrough: null as string | null, // 月次締め済みの最終月 YYYY-MM（B25）
  };
}

export const TAX_CATEGORY_LABEL = { taxable: "課税", exempt: "非課税", non_taxable: "不課税" } as const;
export const PRORATION_LABEL = { actual: "実日数", fixed30: "30日固定", none: "日割りなし" } as const;
