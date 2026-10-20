import "server-only";
import { findDocs, getDoc } from "../repo";
import { Ctx } from "../session";
import { C } from "@/lib/types";
import { todayJst } from "@/lib/domain/dates";
import { DOC_TYPES } from "@/lib/labels-documents";
import { builtinTemplate } from "./builtin";
import type { TemplateX } from "./model";

export type ResolvedTemplate = TemplateX & { builtin: boolean };

/** 会社の承認済みテンプレートのうち、適用開始日が到来しているもの（新しい順） */
export async function effectiveCompanyTemplates(ctx: Ctx, docType: string, today = todayJst()): Promise<TemplateX[]> {
  const list = await findDocs<TemplateX>(ctx, C.templates, [["docType", "==", docType], ["status", "==", "approved"]], 200);
  return list
    .filter((t) => !t.archived && t.effectiveFrom <= today)
    .sort((a, b) => (a.effectiveFrom !== b.effectiveFrom ? (a.effectiveFrom < b.effectiveFrom ? 1 : -1) : b.versionNo - a.versionNo));
}

function asBuiltin(docType: string): ResolvedTemplate | null {
  const b = builtinTemplate(docType);
  return b ? { ...b, familyId: b.id, previousId: null, changeNote: null, builtin: true } : null;
}

/**
 * 書類作成に使うテンプレートを決める。
 * - templateId 指定時: その承認済みテンプレート（種別一致・適用開始済み）。標準書類は builtin:xxx も可。
 * - 未指定: 会社の承認済みテンプレート → 標準書類なら既定テンプレート。
 * - 契約関係書類で承認済みテンプレートがない場合は null（書式未設定）。
 */
export async function pickTemplate(ctx: Ctx, docType: string, templateId?: string | null): Promise<ResolvedTemplate | null> {
  const def = DOC_TYPES[docType];
  if (!def) return null;
  if (templateId) {
    if (templateId.startsWith("builtin:")) return templateId === `builtin:${docType}` ? asBuiltin(docType) : null;
    const t = await getDoc<TemplateX>(ctx, C.templates, templateId);
    if (!t || t.archived || t.docType !== docType || t.status !== "approved" || t.effectiveFrom > todayJst()) return null;
    return { ...t, builtin: false };
  }
  const company = await effectiveCompanyTemplates(ctx, docType);
  if (company[0]) return { ...company[0], builtin: false };
  return asBuiltin(docType);
}

/** 作成画面の選択肢 */
export async function templateChoices(ctx: Ctx, docType: string): Promise<ResolvedTemplate[]> {
  const out: ResolvedTemplate[] = (await effectiveCompanyTemplates(ctx, docType)).map((t) => ({ ...t, builtin: false }));
  const b = asBuiltin(docType);
  if (b) out.push(b);
  return out;
}
