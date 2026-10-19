import "server-only";
import { adminBucket, adminDb } from "./firebase-admin";
import { col, nowIso, audit, keywords } from "./repo";
import { Ctx } from "./session";
import { sniff, isAllowedName } from "./files";
import { companySettings } from "./lookups";
import type { Attachment } from "@/lib/types";
import type { Cap } from "@/lib/permissions";

/** 関連先ごとの閲覧に必要な権限 */
export const ENTITY_READ_CAP: Record<string, Cap> = {
  property: "property.read",
  unit: "property.read",
  party: "party.read",
  deal: "deal.read",
  application: "deal.read",
  contract: "contract.read",
  document: "document.read",
  template: "document.read",
  invoice: "billing.read",
  payment: "payment.read",
  settlement: "settlement.read",
  inquiry: "repair.read",
  repair: "repair.read",
  estimate: "repair.read",
  moveout: "lease.read",
  renewal: "lease.read",
  import: "payment.read",
};

export const ENTITY_WRITE_CAP: Record<string, Cap> = {
  property: "property.write",
  unit: "property.write",
  party: "party.write",
  deal: "deal.write",
  application: "deal.write",
  contract: "contract.write",
  document: "document.write",
  template: "template.manage",
  invoice: "billing.write",
  payment: "payment.write",
  settlement: "settlement.write",
  inquiry: "repair.write",
  repair: "repair.write",
  estimate: "repair.write",
  moveout: "lease.write",
  renewal: "lease.write",
  import: "payment.write",
};

/** 社内利用者がこの添付を閲覧できるか */
export function staffCanView(ctx: Ctx, a: Attachment): boolean {
  if (a.companyId !== ctx.companyId) return false;
  if (a.quarantined) return false;
  if (a.sensitive && !ctx.caps.has("party.sensitive")) return false;
  return a.links.some((l) => ENTITY_READ_CAP[l.entity] && ctx.caps.has(ENTITY_READ_CAP[l.entity]));
}

export interface UploadInput {
  file: File;
  entity: string;
  entityId: string;
  category: string;
  visibility: Attachment["visibility"];
  sensitive: boolean;
  description?: string | null;
  takenAt?: string | null;
}

/** 1ファイル登録。検証失敗は理由を返す（例外にしない） */
export async function storeUpload(ctx: Ctx, input: UploadInput): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const settings = await companySettings(ctx.companyId);
  const maxMB = settings.fileMaxMB ?? 30;
  const f = input.file;
  if (!isAllowedName(f.name)) return { ok: false, error: `${f.name}: 対象外のファイル形式です（PDF・JPEG・PNG・WebP・DOCX・XLSX・CSV）` };
  if (f.size > maxMB * 1024 * 1024) return { ok: false, error: `${f.name}: ${maxMB}MBを超えています` };
  const buf = new Uint8Array(await f.arrayBuffer());
  const s = sniff(buf, f.name);
  const r = col(ctx.companyId, "attachments").doc();
  const quarantined = !s;
  const storagePath = `companies/${ctx.companyId}/${quarantined ? "quarantine" : "files"}/${r.id}`;
  await adminBucket().file(storagePath).save(Buffer.from(buf), {
    contentType: s?.type ?? "application/octet-stream",
    resumable: false,
    metadata: { contentDisposition: "attachment" },
  });
  const t = nowIso();
  const doc: Attachment = {
    id: r.id,
    companyId: ctx.companyId,
    createdAt: t,
    updatedAt: t,
    createdBy: ctx.uid,
    updatedBy: ctx.uid,
    version: 1,
    archived: false,
    fileName: f.name.slice(0, 200),
    storagePath,
    size: f.size,
    contentType: s?.type ?? "application/octet-stream",
    category: input.category || "その他",
    description: input.description ?? null,
    takenAt: input.takenAt ?? null,
    visibility: input.visibility,
    sort: Date.now(),
    sensitive: input.sensitive,
    quarantined,
    links: [{ entity: input.entity, id: input.entityId }],
    linkKeys: [`${input.entity}:${input.entityId}`],
    uploadedBy: ctx.uid,
  };
  await adminDb().runTransaction(async (tx) => {
    tx.create(r, { ...doc, keywords: keywords(f.name, input.description) });
    audit(tx, ctx, quarantined ? "attachment.quarantine" : "attachment.upload", "attachments", r.id, {
      fileName: doc.fileName,
      entity: input.entity,
      entityId: input.entityId,
    });
  });
  if (quarantined) return { ok: false, error: `${f.name}: ファイルの中身が形式と一致しないか危険なファイルのため隔離しました` };
  return { ok: true, id: r.id };
}

export async function listAttachments(ctx: Ctx, entity: string, entityId: string): Promise<Attachment[]> {
  const snap = await col(ctx.companyId, "attachments").where("linkKeys", "array-contains", `${entity}:${entityId}`).limit(500).get();
  return snap.docs
    .map((d) => ({ ...(d.data() as Attachment), id: d.id }))
    .filter((a) => !a.archived && staffCanView(ctx, a))
    .sort((a, b) => a.sort - b.sort);
}

export function entityCollection(entity: string): string {
  const map: Record<string, string> = {
    property: "properties", unit: "units", party: "parties", deal: "deals", application: "applications",
    contract: "contracts", document: "documents", template: "templates", invoice: "invoices", payment: "payments",
    settlement: "settlements", inquiry: "inquiries", repair: "repairs", estimate: "estimates", moveout: "moveouts",
    renewal: "renewals", import: "importBatches",
  };
  return map[entity] ?? "__none__";
}
