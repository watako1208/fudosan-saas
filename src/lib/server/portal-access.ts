import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { col } from "./repo";
import { Ctx, getCtx } from "./session";
import type { Attachment, DocBlock } from "@/lib/types";

/**
 * 外部利用者（顧客・入居者・オーナー・工事業者）が閲覧できる対象の集合。
 * 自分に公開された対象以外は閲覧できない（T14）。
 */
export interface ExternalScope {
  partyId: string;
  kind: "customer" | "tenant" | "owner" | "vendor";
  propertyIds: Set<string>;
  unitIds: Set<string>;
  dealIds: Set<string>;
  contractIds: Set<string>;
  repairIds: Set<string>;
  estimateIds: Set<string>;
  settlementIds: Set<string>;
  inquiryIds: Set<string>;
  proposalIds: Set<string>;
  documentIds: Set<string>;
}

async function ids(ctx: Ctx, name: string, field: string, op: FirebaseFirestore.WhereFilterOp, value: unknown): Promise<string[]> {
  const snap = await col(ctx.companyId, name).where(field, op, value).select().limit(1000).get();
  return snap.docs.map((d) => d.id);
}

export const externalScope = cache(async (ctx: Ctx): Promise<ExternalScope | null> => {
  if (ctx.isStaff || !ctx.user.partyId) return null;
  const partyId = ctx.user.partyId;
  const kind = ctx.user.kind as ExternalScope["kind"];
  const s: ExternalScope = {
    partyId,
    kind,
    propertyIds: new Set(),
    unitIds: new Set(),
    dealIds: new Set(),
    contractIds: new Set(),
    repairIds: new Set(),
    estimateIds: new Set(),
    settlementIds: new Set(),
    inquiryIds: new Set(),
    proposalIds: new Set(),
    documentIds: new Set(),
  };
  s.inquiryIds = new Set(await ids(ctx, "inquiries", "partyId", "==", partyId));
  if (kind === "owner") {
    const own = await col(ctx.companyId, "ownerships").where("partyId", "==", partyId).limit(500).get();
    own.docs.forEach((d) => s.propertyIds.add(d.data().propertyId));
    s.settlementIds = new Set(await ids(ctx, "settlements", "ownerPartyId", "==", partyId));
    for (const chunk of chunks([...s.propertyIds], 30)) {
      (await ids(ctx, "repairs", "propertyId", "in", chunk)).forEach((x) => s.repairIds.add(x));
      (await ids(ctx, "units", "propertyId", "in", chunk)).forEach((x) => s.unitIds.add(x));
    }
  }
  if (kind === "tenant") {
    s.contractIds = new Set(await ids(ctx, "contracts", "partyIds", "array-contains", partyId));
    const cs = await col(ctx.companyId, "contracts").where("partyIds", "array-contains", partyId).limit(100).get();
    cs.docs.forEach((d) => d.data().unitId && s.unitIds.add(d.data().unitId));
  }
  if (kind === "customer") {
    s.dealIds = new Set(await ids(ctx, "deals", "customerId", "==", partyId));
    // 提案は「本人宛て かつ 公開済み」のみ
    const ps = await col(ctx.companyId, "proposals").where("customerId", "==", partyId).where("publishedToCustomer", "==", true).select().limit(500).get();
    ps.docs.forEach((d) => s.proposalIds.add(d.id));
  }
  if (kind === "vendor") {
    s.repairIds = new Set(await ids(ctx, "repairs", "vendorPartyId", "==", partyId));
  }
  for (const chunk of chunks([...s.repairIds], 30)) {
    (await ids(ctx, "estimates", "repairId", "in", chunk)).forEach((x) => s.estimateIds.add(x));
  }
  // 公開書類: 発行済み かつ 本人が公開先 かつ 利用者種別へ公開
  const docs = await col(ctx.companyId, "documents").where("partyIds", "array-contains", partyId).where("status", "==", "issued").select("publishedTo").limit(500).get();
  docs.docs.forEach((d) => {
    if (((d.data().publishedTo ?? []) as string[]).includes(kind)) s.documentIds.add(d.id);
  });
  return s;
});

/**
 * 外部利用者ページ用: 未ログインはログインへ、社内利用者はホームへ。
 * 関係者（partyId）が紐づいていない外部利用者は scope=null を返す（画面で案内を表示）。
 */
export async function requireExternalPage(): Promise<{ ctx: Ctx; scope: ExternalScope | null }> {
  const ctx = await getCtx();
  if (!ctx) redirect("/login?next=/portal");
  if (ctx.isStaff) redirect("/home");
  return { ctx, scope: await externalScope(ctx) };
}

/** 公開書類の現行版に画像として含まれる添付ID（書類内の画像表示用） */
export const publishedDocumentImageIds = cache(async (ctx: Ctx): Promise<Set<string>> => {
  const s = await externalScope(ctx);
  const out = new Set<string>();
  if (!s || !s.documentIds.size) return out;
  const docs = await Promise.all([...s.documentIds].slice(0, 100).map((id) => col(ctx.companyId, "documents").doc(id).get()));
  const verIds = docs.map((d) => d.data()?.currentVersionId as string | undefined).filter((x): x is string => !!x);
  const vers = await Promise.all(verIds.map((id) => col(ctx.companyId, "documentVersions").doc(id).get()));
  for (const v of vers) {
    const data = v.data();
    if (!data || data.companyId !== ctx.companyId || data.status !== "issued") continue;
    for (const b of (data.blocks ?? []) as DocBlock[]) if (b.type === "image") out.add(b.attachmentId);
  }
  return out;
});

function chunks<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** 添付の閲覧可否: 公開範囲が利用者種別と一致し、かつ関連先が自分の閲覧範囲内 */
export async function externalCanViewAttachment(ctx: Ctx, a: Attachment): Promise<boolean> {
  if (a.companyId !== ctx.companyId || a.sensitive || a.quarantined || a.archived) {
    // 本人がアップロードした提出資料は本人のみ閲覧可
    return a.companyId === ctx.companyId && a.uploadedBy === ctx.uid && !a.quarantined;
  }
  if (a.uploadedBy === ctx.uid) return true;
  // 発行済み・公開済み書類に画像として含まれるもの（社内のみの添付でも、公開書類の一部として表示する）
  if ((await publishedDocumentImageIds(ctx)).has(a.id)) return true;
  if (a.visibility !== ctx.user.kind) return false;
  const s = await externalScope(ctx);
  if (!s) return false;
  const setFor: Record<string, Set<string>> = {
    property: s.propertyIds,
    unit: s.unitIds,
    deal: s.dealIds,
    contract: s.contractIds,
    repair: s.repairIds,
    estimate: s.estimateIds,
    settlement: s.settlementIds,
    inquiry: s.inquiryIds,
    proposal: s.proposalIds,
    document: s.documentIds,
  };
  return a.links.some((l) => setFor[l.entity]?.has(l.id));
}
