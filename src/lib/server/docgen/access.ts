import "server-only";
import { getDoc, findDocs, NotFoundError } from "../repo";
import { Ctx, AuthError, canAccessStore } from "../session";
import { ENTITY_READ_CAP, listAttachments } from "../attachments";
import { C, Attachment } from "@/lib/types";
import type { DocumentX, DocVersionX } from "./model";

/** 書類の閲覧可否: document.read に加え、差込み元の閲覧権限と店舗範囲を確認する */
export function canReadDocument(ctx: Ctx, d: DocumentX): boolean {
  if (!ctx.isStaff || !ctx.caps.has("document.read")) return false;
  const cap = ENTITY_READ_CAP[d.entity];
  if (cap && !ctx.caps.has(cap)) return false;
  return canAccessStore(ctx, d.storeId);
}

export async function loadDocument(ctx: Ctx, id: string): Promise<DocumentX> {
  const d = await getDoc<DocumentX>(ctx, C.documents, id);
  if (!d) throw new NotFoundError();
  if (!canReadDocument(ctx, d)) throw new AuthError("この書類を閲覧する権限がありません");
  return d;
}

export async function listVersions(ctx: Ctx, documentId: string): Promise<DocVersionX[]> {
  const vs = await findDocs<DocVersionX>(ctx, C.documentVersions, [["documentId", "==", documentId]], 200);
  return vs.sort((a, b) => b.versionNo - a.versionNo);
}

export async function loadVersion(ctx: Ctx, d: DocumentX, versionNo?: number | null): Promise<DocVersionX> {
  if (!versionNo) {
    const v = d.currentVersionId ? await getDoc<DocVersionX>(ctx, C.documentVersions, d.currentVersionId) : null;
    if (!v || v.documentId !== d.id) throw new NotFoundError();
    return v;
  }
  const vs = await findDocs<DocVersionX>(ctx, C.documentVersions, [["documentId", "==", d.id], ["versionNo", "==", versionNo]], 2);
  if (!vs[0]) throw new NotFoundError();
  return vs[0];
}

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** 書類に挿入できる画像: 差込み元（関連する物件・区画等を含む）とテンプレートの添付のうち閲覧可能な画像 */
export async function availableImages(ctx: Ctx, v: Pick<DocVersionX, "data" | "templateId">): Promise<Attachment[]> {
  const ents = [...(v.data?.meta?.attachEntities ?? [])];
  if (v.templateId && !v.templateId.startsWith("builtin:")) ents.push({ entity: "template", id: v.templateId });
  const out = new Map<string, Attachment>();
  for (const e of ents.slice(0, 20)) {
    for (const a of await listAttachments(ctx, e.entity, e.id)) {
      if (IMAGE_TYPES.includes(a.contentType) && !a.sensitive) out.set(a.id, a);
    }
  }
  return [...out.values()];
}
