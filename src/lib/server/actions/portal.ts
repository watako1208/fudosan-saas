"use server";
import { createHash, randomBytes } from "crypto";
import { adminDb } from "../firebase-admin";
import { requireExternal, requireStaff, canAccessStore, Ctx } from "../session";
import { run, str, optStr, ActionResult } from "../action";
import { ValidationError, txGet, txCreate, txUpdate, audit, keywords, txNextNumber, runOnce, getDoc, nowIso, col, BaseDoc } from "../repo";
import { notify } from "../notify";
import { externalScope } from "../portal-access";
import { companySettings } from "../lookups";
import { C, Inquiry, Unit, Property, Party, Deal, ApprovalRecord, ShareLink, Activity } from "@/lib/types";
import type { Proposal, ProposalReaction } from "@/lib/types-deals";
import { computeEstimate, validateEstimateLines, isShareable, EstimateLineInput, RepairExt, EstimateExt } from "@/lib/labels-support";

/** 社内の通知先: 物件担当 → いなければ修繕担当・店舗責任者・管理者 */
async function staffRecipients(ctx: Ctx, property: Property | null, storeId: string | null): Promise<string[]> {
  if (property?.assigneeUid) return [property.assigneeUid];
  const snap = await adminDb().collection("users").where("companyId", "==", ctx.companyId).where("kind", "==", "staff").limit(500).get();
  return snap.docs
    .filter((d) => {
      const u = d.data();
      if (u.disabled) return false;
      const roles = (u.roles ?? []) as string[];
      if (roles.includes("admin")) return true;
      if (!roles.includes("repair") && !roles.includes("store_manager")) return false;
      return !storeId || ((u.storeIds ?? []) as string[]).includes(storeId);
    })
    .map((d) => d.id)
    .slice(0, 20);
}

// ───────────── 顧客: 提案への反応 ─────────────

export async function reactToProposal(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireExternal();
    const scope = await externalScope(ctx);
    const proposalId = str(input.proposalId);
    if (!scope || scope.kind !== "customer" || !scope.proposalIds.has(proposalId)) throw new ValidationError(["この提案に回答する権限がありません"]);
    const kind = str(input.kind) as ProposalReaction["kind"];
    if (!["interested", "viewing_request", "declined"].includes(kind)) throw new ValidationError(["回答の種類が不正です"]);
    const reason = optStr(input.reason);
    if (kind === "declined" && !reason) throw new ValidationError(["見送りの理由を入力してください"]);
    const itemIndex = Number(input.itemIndex);
    let dealId: string | null = null;
    await runOnce(ctx, str(input._requestId), async (tx) => {
      const p = await txGet<Proposal>(tx, ctx, C.proposals, proposalId);
      if (p.customerId !== scope.partyId || !p.publishedToCustomer) throw new ValidationError(["この提案に回答する権限がありません"]);
      if (!Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= (p.items ?? []).length) throw new ValidationError(["対象の物件が見つかりません"]);
      const r: ProposalReaction = { itemIndex, kind, reason: reason?.slice(0, 500) ?? null, at: nowIso(), byUid: ctx.uid };
      txUpdate(tx, ctx, C.proposals, p, null, { reactions: [...(p.reactions ?? []), r] });
      audit(tx, ctx, "proposal.reaction", C.proposals, p.id, { itemIndex, kind });
      dealId = p.dealId;
      return null;
    });
    if (dealId) {
      const deal = await getDoc<Deal>(ctx, C.deals, dealId);
      const label = { interested: "気になる", viewing_request: "内見希望", declined: "見送り" }[kind];
      await notify(ctx, { toUid: deal?.assigneeUid, kind: "proposal.reaction", title: `提案に回答がありました（${label}）`, href: `/deals/${dealId}`, dedupeKey: `proposal:${proposalId}:reaction:${itemIndex}:${kind}:${Date.now()}` });
    }
    return null;
  });
}

// ───────────── 入居者・オーナー: 問い合わせ・申請 ─────────────

export async function submitPortalInquiry(input: Record<string, unknown>): Promise<ActionResult<{ redirect: string }>> {
  return run(async () => {
    const ctx = await requireExternal();
    const scope = await externalScope(ctx);
    if (!scope || (scope.kind !== "tenant" && scope.kind !== "owner")) throw new ValidationError(["この操作は入居者・オーナーのみ行えます"]);
    const fe: Record<string, string> = {};
    const category = str(input.category) as Inquiry["category"];
    if (!["equipment", "noise", "leak", "key", "contract", "payment", "other"].includes(category)) fe.category = "分類を選択してください";
    const urgency = (str(input.urgency) || "normal") as Inquiry["urgency"];
    if (!["low", "normal", "high", "emergency"].includes(urgency)) fe.urgency = "緊急度を選択してください";
    const content = str(input.content);
    if (!content) fe.content = "内容を入力してください";
    const unitId = optStr(input.unitId);
    const propertyIdIn = optStr(input.propertyId);
    if (unitId && !scope.unitIds.has(unitId)) fe.unitId = "対象の部屋を選択してください";
    if (propertyIdIn && !scope.propertyIds.has(propertyIdIn)) fe.propertyId = "対象の物件を選択してください";
    if (Object.keys(fe).length) throw new ValidationError(Object.values(fe), fe);
    const unit = unitId ? await getDoc<Unit>(ctx, C.units, unitId) : null;
    const property = await getDoc<Property>(ctx, C.properties, unit?.propertyId ?? propertyIdIn ?? "");
    const party = await getDoc<Party>(ctx, C.parties, scope.partyId);
    const storeId = unit?.storeId ?? property?.storeId ?? null;
    const id = await runOnce(ctx, str(input._requestId), async (tx) => {
      const number = await txNextNumber(tx, ctx, "inquiry", "Q");
      const id = txCreate(tx, ctx, C.inquiries, {
        number,
        receivedAt: nowIso(),
        partyId: scope.partyId,
        partyName: party?.name ?? ctx.user.displayName,
        propertyId: property?.id ?? null,
        unitId: unit?.id ?? null,
        category,
        urgency,
        content: content.slice(0, 4000),
        assigneeUid: property?.assigneeUid ?? null,
        due: null,
        status: "open",
        repairIds: [],
        storeId,
        source: "portal",
        keywords: keywords(number, party?.name, property?.name, property?.address, unit?.number, content.slice(0, 60)),
      } satisfies Omit<Inquiry, keyof BaseDoc>);
      txCreate(tx, ctx, C.activities, {
        entity: "inquiry", entityId: id, channel: "portal", direction: "in", at: nowIso(), summary: "外部利用者ページから受付", body: null, byUid: ctx.uid,
      } satisfies Omit<Activity, keyof BaseDoc>);
      audit(tx, ctx, "portal.inquiry", C.inquiries, id, { number, category, urgency });
      return id;
    });
    for (const uid of await staffRecipients(ctx, property, storeId)) {
      await notify(ctx, { toUid: uid, kind: "inquiry.portal", title: `外部利用者ページから問い合わせがありました（${party?.name ?? ""}）`, href: `/support/${id}`, dedupeKey: `inquiry:${id}:portal` });
    }
    return { redirect: "/portal/inquiries" };
  });
}

// ───────────── オーナー: 見積承認の回答 ─────────────

/**
 * オーナーの回答を記録する。電子署名による契約締結ではなく「内容を確認し回答した記録」。
 * 認証時刻・対象版・回答・コメントを保存する。
 */
export async function answerOwnerEstimate(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireExternal();
    const scope = await externalScope(ctx);
    const id = str(input.estimateId);
    if (!scope || scope.kind !== "owner" || !scope.estimateIds.has(id)) throw new ValidationError(["この見積に回答する権限がありません"]);
    const answer = str(input.answer) as "approve" | "reject";
    if (answer !== "approve" && answer !== "reject") throw new ValidationError(["回答を選択してください"]);
    const comment = optStr(input.comment);
    if (answer === "reject" && !comment) throw new ValidationError(["承認しない理由をコメントに入力してください"]);
    const versionNo = Number(input.versionNo);
    let repair: RepairExt | null = null;
    await adminDb().runTransaction(async (tx) => {
      const est = await txGet<EstimateExt>(tx, ctx, C.estimates, id);
      const r = await txGet<RepairExt>(tx, ctx, C.repairs, est.repairId);
      if (!r.propertyId || !scope.propertyIds.has(r.propertyId)) throw new ValidationError(["この見積に回答する権限がありません"]);
      if (!est.ownerApprovalRequested || !(est.ownerPartyIds ?? []).includes(scope.partyId)) throw new ValidationError(["承認依頼のない見積です"]);
      if (est.status !== "submitted") throw new ValidationError(["この見積は回答を受け付けていません（既に回答済みか、変更されています）"]);
      if (est.versionNo !== versionNo) throw new ValidationError(["表示中の版が最新ではありません。画面を再読み込みしてください"]);
      const at = nowIso();
      const rec: ApprovalRecord = { action: answer, by: ctx.uid, byName: `オーナー: ${ctx.user.displayName}`, at, reason: comment, versionId: est.id };
      txUpdate(tx, ctx, C.estimates, est, null, {
        status: answer === "approve" ? "approved" : "rejected",
        approvals: [...est.approvals, rec],
        externalApproval: { partyId: scope.partyId, answer, at, versionNo: est.versionNo, comment },
        externalApprovalAuthTime: ctx.authTime,
      });
      txUpdate(tx, ctx, C.repairs, r, null, answer === "approve" ? { approvedEstimateId: est.id, approvalState: "approved" } : { approvalState: "rejected", status: "awaiting_estimate" });
      audit(tx, ctx, answer === "approve" ? "estimate.owner_approve" : "estimate.owner_reject", C.estimates, est.id, { versionNo: est.versionNo, authTime: ctx.authTime, comment });
      repair = r;
    });
    const rr = repair as RepairExt | null;
    if (rr) {
      await notify(ctx, { toUid: rr.assigneeUid, kind: "estimate.owner_answer", title: `オーナーが見積に回答しました（${answer === "approve" ? "承認" : "承認しない"}）`, href: `/support/repairs/${rr.id}?tab=approvals`, dedupeKey: `estimate:${id}:owner:${answer}` });
    }
    return null;
  });
}

// ───────────── 工事業者: 見積明細の提出 ─────────────

export async function vendorSubmitEstimate(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireExternal();
    const scope = await externalScope(ctx);
    const repairId = str(input.repairId);
    if (!scope || scope.kind !== "vendor" || !scope.repairIds.has(repairId)) throw new ValidationError(["この修繕に見積を提出する権限がありません"]);
    let lines: EstimateLineInput[];
    try {
      lines = (JSON.parse(String(input.lines ?? "[]")) as EstimateLineInput[]).slice(0, 200).map((l) => ({
        name: str(l.name).slice(0, 100),
        quantity: str(l.quantity).normalize("NFKC"),
        unit: str(l.unit).slice(0, 20),
        unitPrice: str(l.unitPrice).normalize("NFKC").replace(/[,¥円]/g, ""),
        tax: { category: l.tax?.category === "exempt" || l.tax?.category === "non_taxable" ? l.tax.category : "taxable", rate: l.tax?.category === "taxable" || !l.tax ? "0.10" : "0", priceMode: "exclusive" },
        burden: [], // 費用負担は社内で判断する（業者は入力しない）
      }));
    } catch {
      throw new ValidationError(["見積明細を読み取れません"]);
    }
    if (!lines.length) throw new ValidationError(["明細を1行以上入力してください"]);
    const errs = validateEstimateLines(lines);
    if (errs.length) throw new ValidationError(errs);
    const s = await companySettings(ctx.companyId);
    const built = computeEstimate(lines, s.lineRounding ?? "floor", s.taxRounding ?? "floor");
    const data = {
      lines: built.lines.map((l) => ({ name: l.name, quantity: l.quantity, unit: l.unit, unitPrice: l.unitPrice, amount: l.amount, tax: l.tax, burden: [] })),
      subtotal: built.subtotal, tax: built.tax, total: built.total,
    };
    let assignee: string | null = null;
    await runOnce(ctx, str(input._requestId), async (tx) => {
      const repair = await txGet<RepairExt>(tx, ctx, C.repairs, repairId);
      if (repair.vendorPartyId !== scope.partyId) throw new ValidationError(["この修繕に見積を提出する権限がありません"]);
      if (["completed", "cancelled"].includes(repair.status)) throw new ValidationError(["完了・中止した修繕には提出できません"]);
      const cur = repair.currentEstimateId ? await txGet<EstimateExt>(tx, ctx, C.estimates, repair.currentEstimateId) : null;
      assignee = repair.assigneeUid;
      if (!cur) {
        const id = txCreate(tx, ctx, C.estimates, {
          repairId, versionNo: 1, previousId: null, reason: "業者からの見積提出", ...data, status: "draft", approvals: [], externalApproval: null, submittedByVendor: true,
        } satisfies Omit<EstimateExt, keyof BaseDoc>);
        txUpdate(tx, ctx, C.repairs, repair, null, { currentEstimateId: id, approvalState: "none", status: ["received", "site_check"].includes(repair.status) ? "awaiting_estimate" : repair.status });
        audit(tx, ctx, "portal.vendor_estimate", C.estimates, id, { repairId, total: data.total });
        return id;
      }
      if (cur.status === "draft" && cur.createdBy === ctx.uid) {
        txUpdate(tx, ctx, C.estimates, cur, null, data);
        audit(tx, ctx, "portal.vendor_estimate", C.estimates, cur.id, { repairId, total: data.total });
        return cur.id;
      }
      throw new ValidationError(["社内で確認中または承認済みの見積があるため提出できません。追加・変更は担当者へご連絡ください（担当者が変更版を作成します）"]);
    });
    await notify(ctx, { toUid: assignee, kind: "estimate.vendor", title: "業者から見積明細が提出されました（費用負担の入力が必要です）", href: `/support/repairs/${repairId}?tab=estimate`, dedupeKey: `repair:${repairId}:vendor_estimate:${Date.now()}` });
    return null;
  });
}

// ───────────── 共有リンク（提案の閲覧のみ） ─────────────

/** 提案の共有リンクを作成する。トークンは一度だけ表示し、保存するのは SHA-256 のみ */
export async function createProposalShareLink(input: Record<string, unknown>): Promise<ActionResult<{ url: string; expiresAt: string }>> {
  return run(async () => {
    const ctx = await requireStaff("deal.write");
    const entity = "proposal";
    const purpose = "proposal_view";
    if (!isShareable(purpose, entity)) throw new ValidationError(["この資料は共有リンクの対象外です"]);
    const p = await getDoc<Proposal>(ctx, C.proposals, str(input.proposalId));
    if (!p) throw new ValidationError(["提案が見つかりません"]);
    if (!canAccessStore(ctx, p.storeId)) throw new ValidationError(["権限がありません"]);
    const days = Math.min(30, Math.max(1, Number(input.days) || 7));
    const token = `${ctx.companyId}.${randomBytes(32).toString("base64url")}`;
    const hash = createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + days * 86400000).toISOString();
    await adminDb().runTransaction(async (tx) => {
      txCreate(tx, ctx, C.shareLinks, {
        token: hash, // 生のトークンは保存しない
        purpose, entity, entityId: p.id, expiresAt, revoked: false, requiresLogin: false,
      } satisfies Omit<ShareLink, keyof BaseDoc>, hash);
      audit(tx, ctx, "share.create", C.shareLinks, hash, { entity, entityId: p.id, expiresAt });
    });
    return { url: `/share/${token}`, expiresAt };
  });
}

export async function revokeShareLink(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff("deal.write");
    await adminDb().runTransaction(async (tx) => {
      const l = await txGet<ShareLink>(tx, ctx, C.shareLinks, str(input.id));
      txUpdate(tx, ctx, C.shareLinks, l, null, { revoked: true });
      audit(tx, ctx, "share.revoke", C.shareLinks, l.id, { entity: l.entity, entityId: l.entityId });
    });
    return null;
  });
}

/** 提案の共有リンク一覧（社内用） */
export async function listProposalShareLinks(proposalId: string): Promise<{ id: string; expiresAt: string; revoked: boolean; createdAt: string }[]> {
  const ctx = await requireStaff("deal.read");
  const snap = await col(ctx.companyId, C.shareLinks).where("entity", "==", "proposal").where("entityId", "==", str(proposalId)).limit(50).get();
  return snap.docs.map((d) => ({ id: d.id, expiresAt: d.data().expiresAt, revoked: !!d.data().revoked, createdAt: d.data().createdAt }));
}
