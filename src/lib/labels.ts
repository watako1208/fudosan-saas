import type { Tone } from "@/components/ui";

type L = Record<string, { label: string; tone?: Tone }>;

export const PROPERTY_KIND: L = {
  land: { label: "土地" },
  building: { label: "一棟建物" },
  condo_unit: { label: "区分マンション" },
  house: { label: "戸建" },
  parking_lot: { label: "駐車場" },
};

export const USAGE: L = {
  residential: { label: "住宅" },
  store: { label: "店舗" },
  office: { label: "事務所" },
  parking: { label: "駐車区画" },
  other: { label: "その他" },
};

export const OCCUPANCY: L = {
  vacant: { label: "空室", tone: "info" },
  occupied: { label: "入居中", tone: "ok" },
  notice_given: { label: "退去予定", tone: "warn" },
  unavailable: { label: "利用不可", tone: "neutral" },
};

export const LISTING_STATUS: L = {
  preparing: { label: "募集準備", tone: "neutral" },
  open: { label: "募集中", tone: "info" },
  applied: { label: "申込あり", tone: "warn" },
  closed: { label: "募集終了", tone: "neutral" },
  suspended: { label: "募集停止", tone: "neutral" },
};

export const AREA_KIND: L = {
  land: { label: "土地" },
  floor_total: { label: "延床" },
  exclusive: { label: "専有" },
  balcony: { label: "バルコニー" },
  other: { label: "その他" },
};

export const AREA_BASIS: L = {
  registry: { label: "登記" },
  survey: { label: "実測" },
  wall_center: { label: "壁芯" },
  inner: { label: "内法" },
  other: { label: "その他" },
};

export const TRANSACTION_MODE: L = {
  owner: { label: "売主・貸主" },
  agent: { label: "代理" },
  broker_exclusive: { label: "専任媒介" },
  broker_general: { label: "一般媒介" },
  broker: { label: "仲介" },
};

export const VISIBILITY: L = {
  internal: { label: "社内のみ" },
  customer: { label: "顧客に公開" },
  owner: { label: "オーナーに公開" },
  tenant: { label: "入居者に公開" },
  vendor: { label: "業者に公開" },
  public_share: { label: "共有ページで公開" },
};

export const PARTY_ROLE: L = {
  lessor: { label: "貸主" },
  lessee: { label: "借主" },
  seller: { label: "売主" },
  buyer: { label: "買主" },
  prospect_tenant: { label: "入居希望者" },
  prospect_buyer: { label: "購入希望者" },
  owner: { label: "オーナー" },
  tenant: { label: "入居者" },
  guarantor: { label: "連帯保証人" },
  occupant: { label: "同居人" },
  vendor: { label: "工事業者" },
  contact_person: { label: "法人担当者" },
  other: { label: "その他" },
};

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

/** (key,label) 配列からの変換（rules.ts の状態定義用） */
export function fromPairs(list: readonly (readonly [string, string])[]) {
  return list.map(([value, label]) => ({ value, label }));
}
