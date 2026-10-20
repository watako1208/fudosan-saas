"use server";
import { adminDb } from "../firebase-admin";
import { requireStaff, canAccessStore, Ctx } from "../session";
import { run, str, optStr, optYen, ActionResult } from "../action";
import { ValidationError, txGet, txCreate, txUpdate, audit, keywords, txNextNumber, runOnce, getDoc, findDocs, nowIso, ref, BaseDoc } from "../repo";
import { notify } from "../notify";
import { companySettings } from "../lookups";
import { C, Inquiry, Property, Unit, Party, Ownership, ApprovalRecord } from "@/lib/types";
import { isValidBizDate, todayJst } from "@/lib/domain/dates";
import { validateEstimateBurden } from "@/lib/domain/rules";
import { computeEstimate, validateEstimateLines, validateRepairTransition, EstimateLineInput, RepairExt, EstimateExt } from "@/lib/labels-support";

function version(v: Record<string, unknown>): number | null {
  return v._version === null || v._version === undefined || v._version === "" ? null : Number(v._version);
}

async function repairTarget(ctx: Ctx, v: Record<string, unknown>, fe: Record<string, string>) {
  let unit: Unit | null = null;
  let property: Property | null = null;
  const unitId = optStr(v.unitId);
  if (unitId) {
    unit = await getDoc<Unit>(ctx, C.units, unitId);
    if (!unit) fe.unitId = "部屋が見つかりません";
  }
  const pid = unit?.propertyId ?? optStr(v.propertyId);
  if (pid) {
    property = await getDoc<Property>(ctx, C.properties, pid);
    if (!property) fe.propertyId = "物件が見つかりません";
  }
  const vendorPartyId = optStr(v.vendorPartyId);
  let vendor: Party | null = null;
  if (vendorPartyId) {
    vendor = await getDoc<Party>(ctx, C.parties, vendorPartyId);
    if (!vendor) fe.vendorPartyId = "業者が見つかりません";
  }
  return { unit, property, vendor };
}

function repairFields(v: Record<string, unknown>) {
  const fe: Record<string, string> = {};
  const symptom = str(v.symptom);
  if (!symptom) fe.symptom = "症状・依頼内容を入力してください";
  const scheduledDate = optStr(v.scheduledDate);
  if (scheduledDate && !isValidBizDate(scheduledDate)) fe.scheduledDate = "施工予定日は YYYY-MM-DD 形式で入力してください";
  return { fe, data: { equipment: optStr(v.equipment), symptom, scheduledDate, assigneeUid: optStr(v.assigneeUid) } };
}

/** 修繕登録（見積明細とは分離して登録する）。問い合わせから作成した場合は相互に関連づける */
export async function createRepair(v: Record<string, unknown>): Promise<ActionResult<{ redirect: string }>> {
  return run(async () => {
    const ctx = await requireStaff("repair.write");
    const { data, fe } = repairFields(v);
    const { unit, property, vendor } = await repairTarget(ctx, v, fe);
    if (Object.keys(fe).length) throw new ValidationError(Object.values(fe), fe);
    const inquiryId = optStr(v.inquiryId);
    const storeId = unit?.storeId ?? property?.storeId ?? null;
    if (!canAccessStore(ctx, storeId)) throw new ValidationError(["この店舗の修繕を登録する権限がありません"]);
    const id = await runOnce(ctx, str(v._requestId), async (tx) => {
      const inq = inquiryId ? await txGet<Inquiry>(tx, ctx, C.inquiries, inquiryId) : null;
      const number = await txNextNumber(tx, ctx, "repair", "R");
      const id = txCreate(tx, ctx, C.repairs, {
        ...data,
        number,
        inquiryId: inq?.id ?? null,
        propertyId: property?.id ?? null,
        unitId: unit?.id ?? null,
        vendorPartyId: vendor?.id ?? null,
        status: "received",
        currentEstimateId: null,
        approvedEstimateId: null,
        completedAt: null,
        completionCheckedBy: null,
        billingStatus: "none",
        paymentStatus: "none",
        storeId: storeId ?? inq?.storeId ?? null,
        approvalState: "none",
        keywords: keywords(number, property?.name, property?.address, unit?.number, data.equipment, data.symptom.slice(0, 60), vendor?.name),
      } satisfies Omit<RepairExt, keyof BaseDoc>);
      if (inq) {
        txUpdate(tx, ctx, C.inquiries, inq, null, { repairIds: [...(inq.repairIds ?? []), id], status: inq.status === "open" ? "in_progress" : inq.status });
      }
      audit(tx, ctx, "create", C.repairs, id, { number, inquiryId: inq?.id ?? null });
      return id;
    });
    if (data.assigneeUid && data.assigneeUid !== ctx.uid) {
      await notify(ctx, { toUid: data.assigneeUid, kind: "repair.assigned", title: "修繕案件の担当になりました", href: `/support/repairs/${id}`, dedupeKey: `repair:${id}:assign:${data.assigneeUid}` });
    }
    return { redirect: `/support/repairs/${id}` };
  });
}

export async function updateRepair(id: string, v: Record<string, unknown>): Promise<ActionResult<{ redirect: string }>> {
  return run(async () => {
    const ctx = await requireStaff("repair.write");
    const { data, fe } = repairFields(v);
    const { unit, property, vendor } = await repairTarget(ctx, v, fe);
    if (Object.keys(fe).length) throw new ValidationError(Object.values(fe), fe);
    let prev: string | null = null;
    await adminDb().runTransaction(async (tx) => {
      const cur = await txGet<RepairExt>(tx, ctx, C.repairs, id);
      if (!canAccessStore(ctx, cur.storeId)) throw new ValidationError(["この店舗の修繕を編集する権限がありません"]);
      prev = cur.assigneeUid;
      if (cur.assigneeUid !== data.assigneeUid && !ctx.caps.has("assignee.change") && cur.assigneeUid && cur.assigneeUid !== ctx.uid) {
        throw new ValidationError(["担当者を変更する権限がありません"], { assigneeUid: "担当変更は店舗責任者以上が行えます" });
      }
      txUpdate(tx, ctx, C.repairs, cur, version(v), {
        ...data,
        propertyId: property?.id ?? null,
        unitId: unit?.id ?? null,
        vendorPartyId: vendor?.id ?? null,
        storeId: unit?.storeId ?? property?.storeId ?? cur.storeId,
        keywords: keywords(cur.number, property?.name, property?.address, unit?.number, data.equipment, data.symptom.slice(0, 60), vendor?.name),
      });
      audit(tx, ctx, "update", C.repairs, id, { ...data, vendorPartyId: vendor?.id ?? null });
    });
    if (data.assigneeUid && data.assigneeUid !== prev && data.assigneeUid !== ctx.uid) {
      await notify(ctx, { toUid: data.assigneeUid, kind: "repair.assigned", title: "修繕案件の担当になりました", href: `/support/repairs/${id}`, dedupeKey: `repair:${id}:assign:${data.assigneeUid}` });
    }
    return { redirect: `/support/repairs/${id}` };
  });
}

export async function setRepairStatus(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff("repair.write");
    const id = str(input.id);
    const to = str(input.status);
    const reason = optStr(input.reason);
    await adminDb().runTransaction(async (tx) => {
      const cur = await txGet<RepairExt>(tx, ctx, C.repairs, id);
      if (!canAccessStore(ctx, cur.storeId)) throw new ValidationError(["権限がありません"]);
      const est = cur.currentEstimateId ? await txGet<EstimateExt>(tx, ctx, C.estimates, cur.currentEstimateId) : null;
      const errs = validateRepairTransition(cur.status, to, { currentEstimateStatus: est?.status ?? null, reason });
      if (errs.length) throw new ValidationError(errs);
      const patch: Record<string, unknown> = { status: to };
      if (to === "ordered") Object.assign(patch, { orderedAt: nowIso(), orderedBy: ctx.uid });
      if (to === "cancelled") patch.cancelReason = reason;
      txUpdate(tx, ctx, C.repairs, cur, null, patch);
      audit(tx, ctx, "status", C.repairs, id, { before: cur.status, after: to, reason });
    });
    return null;
  });
}

/** 完了確認（確認者を記録） */
export async function recordCompletionCheck(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff("repair.write");
    const id = str(input.id);
    await adminDb().runTransaction(async (tx) => {
      const cur = await txGet<RepairExt>(tx, ctx, C.repairs, id);
      if (!canAccessStore(ctx, cur.storeId)) throw new ValidationError(["権限がありません"]);
      if (cur.status !== "awaiting_completion_check") throw new ValidationError(["「完了確認待ち」の修繕のみ完了確認できます"]);
      const t = nowIso();
      txUpdate(tx, ctx, C.repairs, cur, null, { status: "completed", completedAt: t, completionCheckedBy: ctx.uid, completedNote: optStr(input.reason) });
      audit(tx, ctx, "repair.complete", C.repairs, id, { checkedBy: ctx.uid, note: optStr(input.reason) });
    });
    return null;
  });
}

/** 請求・支払状況（修繕進行とは別に管理） */
export async function updateRepairBilling(id: string, v: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff("repair.write");
    const fe: Record<string, string> = {};
    const billingStatus = str(v.billingStatus) as RepairExt["billingStatus"];
    const paymentStatus = str(v.paymentStatus) as RepairExt["paymentStatus"];
    if (!["none", "invoiced", "paid"].includes(billingStatus)) fe.billingStatus = "請求状況を選択してください";
    if (!["none", "scheduled", "paid"].includes(paymentStatus)) fe.paymentStatus = "支払状況を選択してください";
    const vendorBillAmount = optYen(v.vendorBillAmount, "vendorBillAmount", fe);
    const vendorPaidOn = optStr(v.vendorPaidOn);
    if (vendorPaidOn && !isValidBizDate(vendorPaidOn)) fe.vendorPaidOn = "日付は YYYY-MM-DD 形式で入力してください";
    if (Object.keys(fe).length) throw new ValidationError(Object.values(fe), fe);
    await adminDb().runTransaction(async (tx) => {
      const cur = await txGet<RepairExt>(tx, ctx, C.repairs, id);
      if (!canAccessStore(ctx, cur.storeId)) throw new ValidationError(["権限がありません"]);
      const patch = { billingStatus, paymentStatus, vendorBillAmount, vendorPaidOn, invoiceId: optStr(v.invoiceId), billingNote: optStr(v.billingNote) };
      txUpdate(tx, ctx, C.repairs, cur, version(v), patch);
      audit(tx, ctx, "repair.billing", C.repairs, id, patch);
    });
    return null;
  });
}

// ───────────── 見積（版管理: B22/B23/T11） ─────────────

function parseLines(raw: unknown): EstimateLineInput[] {
  try {
    const arr = JSON.parse(String(raw ?? "[]")) as EstimateLineInput[];
    if (!Array.isArray(arr)) throw new Error();
    return arr.slice(0, 200).map((l) => ({
      name: str(l.name).slice(0, 100),
      quantity: str(l.quantity).normalize("NFKC"),
      unit: str(l.unit).slice(0, 20),
      unitPrice: str(l.unitPrice).normalize("NFKC").replace(/[,¥円]/g, ""),
      tax: { category: l.tax?.category ?? "taxable", rate: str(l.tax?.rate ?? "0.10") || "0", priceMode: l.tax?.priceMode === "inclusive" ? "inclusive" : "exclusive" },
      burden: (l.burden ?? []).filter((b) => b && b.party).map((b) => ({ party: b.party, amount: Number(b.amount) })),
    }));
  } catch {
    throw new ValidationError(["見積明細を読み取れません"]);
  }
}

async function buildEstimate(ctx: Ctx, lines: EstimateLineInput[]) {
  const s = await companySettings(ctx.companyId);
  const r = computeEstimate(lines, s.lineRounding ?? "floor", s.taxRounding ?? "floor");
  return {
    lines: r.lines.map((l) => ({ name: l.name, quantity: l.quantity, unit: l.unit, unitPrice: l.unitPrice, amount: l.amount, tax: l.tax, burden: l.burden })),
    subtotal: r.subtotal,
    tax: r.tax,
    total: r.total,
  };
}

/** 見積の下書き保存（未作成なら第1版を作成。下書き・差戻しの版のみ編集可能） */
export async function saveEstimateDraft(v: Record<string, unknown>): Promise<ActionResult<{ redirect: string }>> {
  return run(async () => {
    const ctx = await requireStaff("repair.write");
    const repairId = str(v.repairId);
    const lines = parseLines(v.lines);
    const errs = validateEstimateLines(lines);
    if (errs.length) throw new ValidationError(errs);
    const built = await buildEstimate(ctx, lines);
    await runOnce(ctx, str(v._requestId), async (tx) => {
      const repair = await txGet<RepairExt>(tx, ctx, C.repairs, repairId);
      if (!canAccessStore(ctx, repair.storeId)) throw new ValidationError(["権限がありません"]);
      const cur = repair.currentEstimateId ? await txGet<EstimateExt>(tx, ctx, C.estimates, repair.currentEstimateId) : null;
      if (!cur) {
        const id = txCreate(tx, ctx, C.estimates, {
          repairId, versionNo: 1, previousId: null, reason: null, ...built, status: "draft", approvals: [], externalApproval: null,
        } satisfies Omit<EstimateExt, keyof BaseDoc>);
        txUpdate(tx, ctx, C.repairs, repair, null, { currentEstimateId: id, approvalState: "none", status: repair.status === "received" || repair.status === "site_check" ? "awaiting_estimate" : repair.status });
        audit(tx, ctx, "estimate.create", C.estimates, id, { repairId, versionNo: 1, total: built.total });
        return id;
      }
      if (cur.status !== "draft" && cur.status !== "rejected") {
        throw new ValidationError([cur.status === "approved" ? "承認済みの見積は変更できません。「追加・変更版を作成」から新しい版を作成してください" : "承認待ちの見積は編集できません"]);
      }
      txUpdate(tx, ctx, C.estimates, cur, version(v), { ...built, status: "draft" });
      audit(tx, ctx, "estimate.update", C.estimates, cur.id, { versionNo: cur.versionNo, total: built.total });
      return cur.id;
    });
    return { redirect: `/support/repairs/${repairId}?tab=estimate` };
  });
}

/** 承認申請。B22: 明細ごとの負担額合計が明細金額と一致しなければ申請不可 */
export async function submitEstimate(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff("repair.write");
    const s = await companySettings(ctx.companyId);
    let assignee: string | null = null;
    let repairId = "";
    await adminDb().runTransaction(async (tx) => {
      const est = await txGet<EstimateExt>(tx, ctx, C.estimates, str(input.id));
      const repair = await txGet<RepairExt>(tx, ctx, C.repairs, est.repairId);
      if (!canAccessStore(ctx, repair.storeId)) throw new ValidationError(["権限がありません"]);
      if (repair.currentEstimateId !== est.id) throw new ValidationError(["現行の版ではありません"]);
      if (est.status !== "draft" && est.status !== "rejected") throw new ValidationError(["下書きまたは差戻しの見積のみ申請できます"]);
      if (!est.lines.length) throw new ValidationError(["見積明細を1行以上入力してください"]);
      const errs = [...validateEstimateLines(est.lines), ...validateEstimateBurden(est.lines, s.lineRounding ?? "floor")];
      if (errs.length) throw new ValidationError(["負担額の合計が明細金額と一致しないため承認申請できません", ...errs]);
      const rec: ApprovalRecord = { action: est.approvals.some((a) => a.action === "submit" || a.action === "resubmit") ? "resubmit" : "submit", by: ctx.uid, byName: ctx.user.displayName, at: nowIso(), reason: optStr(input.reason), versionId: est.id };
      txUpdate(tx, ctx, C.estimates, est, null, { status: "submitted", approvals: [...est.approvals, rec] });
      txUpdate(tx, ctx, C.repairs, repair, null, { status: "awaiting_approval", approvalState: "pending" });
      audit(tx, ctx, "estimate.submit", C.estimates, est.id, { versionNo: est.versionNo, total: est.total });
      assignee = repair.assigneeUid;
      repairId = repair.id;
    });
    if (assignee && assignee !== ctx.uid) {
      await notify(ctx, { toUid: assignee, kind: "estimate.submitted", title: "修繕見積が承認待ちになりました", href: `/support/repairs/${repairId}?tab=approvals`, dedupeKey: `estimate:${str(input.id)}:submitted:${Date.now()}` });
    }
    return null;
  });
}

/** 社内承認（repair.approve） */
export async function approveEstimate(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff("repair.approve");
    await decide(ctx, str(input.id), "approve", optStr(input.reason));
    return null;
  });
}

/** 差戻し（理由必須） */
export async function rejectEstimate(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff("repair.approve");
    const reason = optStr(input.reason);
    if (!reason) throw new ValidationError(["差戻しの理由を入力してください"]);
    await decide(ctx, str(input.id), "reject", reason);
    return null;
  });
}

async function decide(ctx: Ctx, id: string, action: "approve" | "reject", reason: string | null) {
  let notifyTo: string | null = null;
  let repairId = "";
  await adminDb().runTransaction(async (tx) => {
    const est = await txGet<EstimateExt>(tx, ctx, C.estimates, id);
    const repair = await txGet<RepairExt>(tx, ctx, C.repairs, est.repairId);
    if (!canAccessStore(ctx, repair.storeId)) throw new ValidationError(["権限がありません"]);
    if (est.status !== "submitted") throw new ValidationError(["承認待ちの見積のみ承認・差戻しできます"]);
    const rec: ApprovalRecord = { action, by: ctx.uid, byName: ctx.user.displayName, at: nowIso(), reason, versionId: est.id };
    txUpdate(tx, ctx, C.estimates, est, null, { status: action === "approve" ? "approved" : "rejected", approvals: [...est.approvals, rec] });
    txUpdate(tx, ctx, C.repairs, repair, null, action === "approve"
      ? { approvedEstimateId: est.id, approvalState: "approved" }
      : { approvalState: "rejected", status: "awaiting_estimate" });
    audit(tx, ctx, action === "approve" ? "estimate.approve" : "estimate.reject", C.estimates, est.id, { versionNo: est.versionNo, total: est.total, reason });
    notifyTo = est.createdBy;
    repairId = repair.id;
  });
  if (notifyTo && notifyTo !== ctx.uid) {
    await notify(ctx, { toUid: notifyTo, kind: `estimate.${action}`, title: action === "approve" ? "修繕見積が承認されました" : "修繕見積が差し戻されました", href: `/support/repairs/${repairId}?tab=approvals`, dedupeKey: `estimate:${id}:${action}:${Date.now()}` });
  }
}

/** オーナーへ承認を依頼（外部利用者ページに表示。外部への送信は行わない） */
export async function requestOwnerApproval(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff("repair.write");
    const est = await getDoc<EstimateExt>(ctx, C.estimates, str(input.id));
    if (!est) throw new ValidationError(["見積が見つかりません"]);
    const repair = await getDoc<RepairExt>(ctx, C.repairs, est.repairId);
    if (!repair?.propertyId) throw new ValidationError(["物件が設定されていない修繕はオーナー承認を依頼できません"]);
    const today = todayJst();
    const owners = (await findDocs<Ownership>(ctx, C.ownerships, [["propertyId", "==", repair.propertyId]]))
      .filter((o) => !o.archived && o.from <= today && (!o.to || o.to >= today));
    if (!owners.length) throw new ValidationError(["現在の所有者が登録されていません"]);
    await adminDb().runTransaction(async (tx) => {
      const cur = await txGet<EstimateExt>(tx, ctx, C.estimates, est.id);
      if (cur.status !== "submitted") throw new ValidationError(["承認待ちの見積のみオーナー承認を依頼できます"]);
      txUpdate(tx, ctx, C.estimates, cur, null, { ownerApprovalRequested: true, ownerPartyIds: [...new Set(owners.map((o) => o.partyId))] });
      audit(tx, ctx, "estimate.owner_request", C.estimates, cur.id, { ownerPartyIds: owners.map((o) => o.partyId) });
    });
    return null;
  });
}

/** 承認後の金額・施工範囲の変更: 新しい版を作り再承認対象にする（元の版は上書きせず「旧版」として残す） */
export async function createEstimateRevision(input: Record<string, unknown>): Promise<ActionResult<{ redirect: string }>> {
  return run(async () => {
    const ctx = await requireStaff("repair.write");
    const reason = optStr(input.reason);
    if (!reason) throw new ValidationError(["追加・変更の理由を入力してください"]);
    const repairId = str(input.repairId);
    await runOnce(ctx, str(input._requestId), async (tx) => {
      const repair = await txGet<RepairExt>(tx, ctx, C.repairs, repairId);
      if (!canAccessStore(ctx, repair.storeId)) throw new ValidationError(["権限がありません"]);
      if (!repair.currentEstimateId) throw new ValidationError(["見積がありません"]);
      const prev = await txGet<EstimateExt>(tx, ctx, C.estimates, repair.currentEstimateId);
      if (prev.status !== "approved") throw new ValidationError(["承認済みの見積に対してのみ追加・変更版を作成できます（承認前は現在の版を編集してください）"]);
      const id = txCreate(tx, ctx, C.estimates, {
        repairId, versionNo: prev.versionNo + 1, previousId: prev.id, reason,
        lines: prev.lines, subtotal: prev.subtotal, tax: prev.tax, total: prev.total,
        status: "draft", approvals: [], externalApproval: null,
      } satisfies Omit<EstimateExt, keyof BaseDoc>);
      tx.update(ref(ctx, C.estimates, prev.id), { status: "superseded", supersededBy: id, updatedAt: nowIso(), updatedBy: ctx.uid, version: prev.version + 1 });
      txUpdate(tx, ctx, C.repairs, repair, null, { currentEstimateId: id, approvalState: "none" });
      audit(tx, ctx, "estimate.revise", C.estimates, id, { previousId: prev.id, versionNo: prev.versionNo + 1, reason });
      return id;
    });
    return { redirect: `/support/repairs/${repairId}?tab=estimate` };
  });
}
