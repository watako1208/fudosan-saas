// 顧客・仲介案件モジュールの追加型。コレクション名は src/lib/types.ts の C を使う（C.proposals）。
import type { BaseDoc } from "@/lib/server/repo";
import type { Party, PartyRoleKind } from "@/lib/types";

/**
 * 物件提案（S10）。companies/{companyId}/proposals/{id}
 * 顧客ページ（外部利用者）は customerId == 本人 かつ publishedToCustomer == true のものだけを表示し、
 * reactions へ「気になる」「内見希望」「見送り（理由）」を追記する。
 */
export interface Proposal extends BaseDoc {
  dealId: string;
  customerId: string | null;
  storeId: string | null;
  title: string;
  comment: string | null; // 顧客向けの全体コメント
  items: ProposalItem[];
  publishedToCustomer: boolean;
  publishedAt: string | null;
  publishedBy: string | null;
  reactions: ProposalReaction[];
}

/** 提案物件。登録時点の募集条件をスナップショットとして保存する（募集条件を後で変えても提案内容は変わらない） */
export interface ProposalItem {
  propertyId: string;
  unitId: string | null;
  listingId: string | null;
  snapshotAt: string; // ISO
  propertyNumber: string;
  propertyName: string;
  unitNumber: string | null;
  address: string | null;
  layout: string | null;
  dealType: "rent" | "sale" | null;
  rent: number | null;
  commonFee: number | null;
  deposit: number | null;
  keyMoney: number | null;
  price: number | null;
  area: string | null; // 表示用 例: "25.32㎡（壁芯）"
  availableFrom: string | null;
  comment: string | null; // 担当コメント
}

export interface ProposalReaction {
  itemIndex: number;
  kind: "interested" | "viewing_request" | "declined";
  reason: string | null; // 見送り理由
  at: string; // ISO
  byUid: string;
}

/** Party に保存する補助フィールド（重複候補の検索・手動設定の役割） */
export interface PartyExt extends Party {
  manualRoles?: PartyRoleKind[];
  phoneNorms?: string[];
  emailNorm?: string | null;
  nameKey?: string | null;
}
