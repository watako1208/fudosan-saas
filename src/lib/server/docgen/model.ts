// 書類モジュールの保存形式（types.ts の型に、版管理・再反映に必要な項目を追加したもの）
import type { DocBlock, DocumentDoc, DocumentVersion, TemplateDoc } from "@/lib/types";
import type { MergeData, XBlock } from "./engine";

export interface TemplateX extends TemplateDoc {
  /** 同じ書式の版をまとめる識別子（最初の版の id） */
  familyId: string;
  previousId: string | null;
  changeNote: string | null;
}

export interface DocHistory {
  action: "create" | "edit" | "submit" | "approve" | "reject" | "issue" | "revise" | "rerender" | "publish" | "unpublish" | "export";
  by: string;
  byName: string;
  at: string;
  reason: string | null;
}

export interface DocumentX extends DocumentDoc {
  storeId: string | null;
  entityNumber: string | null;
  entityTitle: string;
  currentVersionNo: number;
  /** 最新の発行済み版（外部利用者ページは公開中かつ発行済みの版を表示する） */
  issuedVersionId: string | null;
  issuedVersionNo: number | null;
  /** 公開先の候補（差込み元の関係者）。公開操作までは partyIds は空 */
  candidatePartyIds: string[];
  publishedAt: string | null;
  publishedBy: string | null;
}

export interface DocVersionX extends DocumentVersion {
  blocks: XBlock[];
  data: MergeData & Record<string, unknown>;
  templateId: string | null;
  templateVersionNo: number | null;
  /** 作成時のテンプレート本体（再反映用。テンプレートが後で改版されても変わらない） */
  templateBlocks: DocBlock[];
  /** 描画時のブロック（key → 内容）。現在の内容と一致するものだけ再反映の対象 */
  autoRendered: Record<string, DocBlock>;
  requiredFields: string[];
  /** 未確認項目（差込み時に値がなかった項目のパス） */
  missing: string[];
  sourceUpdatedAt: string | null;
  approvedAt: string | null;
  rejectReason: string | null;
  supersededBy: string | null;
  history: DocHistory[];
}
