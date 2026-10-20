"use server";
import { requireStaff, canAccessStore } from "../session";
import { run, str, optStr, ActionResult } from "../action";
import { ValidationError, txGet, txCreate, txUpdate, audit, runOnce, nowIso, getDoc, BaseDoc } from "../repo";
import { adminDb } from "../firebase-admin";
import { notify } from "../notify";
import { C, ApplicationDoc, Deal, Party } from "@/lib/types";
import { isValidBizDate } from "@/lib/domain/dates";

// S12 申込み。保証会社・審査の外部連携は行わない（保証会社名と結果の記録のみ）。
// 否決理由（rejectReason）は party.sensitive 権限者のみ閲覧・編集できる（画面へ渡す前にサーバーで除去する）。

const STATUSES: ApplicationDoc["status"][] = ["docs_missing", "reviewing", "approved", "rejected", "withdrawn"];
const RESULT_STATUSES = ["approved", "rejected", "withdrawn"];

function ver(v: Record<string, unknown>): number | null {
  return v._version === null || v._version === undefined || v._version === "" ? null : Number(v._version);
}

function parseIds(raw: unknown): string[] {
  if (!raw) return [];
  try {
    const a = JSON.parse(String(raw));
    return Array.isArray(a) ? [...new Set(a.map(String).filter(Boolean))] : [];
  } catch {
    return [];
  }
}

function parseDocs(raw: unknown, fe: Record<string, string>): ApplicationDoc["submittedDocs"] {
  if (!raw) return [];
  try {
    const a = JSON.parse(String(raw)) as ApplicationDoc["submittedDocs"];
    return a
      .filter((d) => str(d.name))
      .map((d) => ({ name: str(d.name).slice(0, 100), received: !!d.received, attachmentId: optStr(d.attachmentId) }));
  } catch {
    fe.submittedDocs = "提出書類の入力内容を読み取れません";
    return [];
  }
}

export async function saveApplication(dealId: string, appId: string | null, v: Record<string, unknown>): Promise<ActionResult<{ redirect: string }>> {
  return run(async () => {
    const ctx = await requireStaff("deal.write");
    const sensitive = ctx.caps.has("party.sensitive");
    const fe: Record<string, string> = {};
    const applicantId = str(v.applicantId);
    if (!applicantId) fe.applicantId = "申込者を選択してください";
    const occupantIds = parseIds(v.occupantIds);
    const desiredMoveIn = optStr(v.desiredMoveIn);
    if (desiredMoveIn && !isValidBizDate(desiredMoveIn)) fe.desiredMoveIn = "日付が正しくありません";
    const status = str(v.status) as ApplicationDoc["status"];
    if (!STATUSES.includes(status)) fe.status = "状態を選択してください";
    const lc = optStr(v.landlordCheck) as ApplicationDoc["landlordCheck"];
    if (lc && !["pending", "ok", "ng"].includes(lc)) fe.landlordCheck = "貸主確認が正しくありません";
    const submittedDocs = parseDocs(v.submittedDocs, fe);
    const unitId = optStr(v.unitId);
    if (Object.keys(fe).length) throw new ValidationError(Object.values(fe), fe);

    const id = await runOnce(ctx, str(v._requestId), async (tx) => {
      const deal = await txGet<Deal>(tx, ctx, C.deals, dealId);
      if (!canAccessStore(ctx, deal.storeId)) throw new ValidationError(["この店舗の案件を編集する権限がありません"]);
      if (unitId && !(deal.unitIds ?? []).includes(unitId)) throw new ValidationError(["部屋・区画は案件の対象物件から選択してください"], { unitId: "案件の対象外です" });
      for (const pid of [applicantId, ...occupantIds]) await txGet<Party>(tx, ctx, C.parties, pid);
      const cur = appId ? await txGet<ApplicationDoc>(tx, ctx, C.applications, appId) : null;
      if (cur && cur.dealId !== dealId) throw new ValidationError(["申込みが案件に属していません"]);
      const statusChanged = !cur || cur.status !== status;
      const isResult = RESULT_STATUSES.includes(status);
      const data: Record<string, unknown> = {
        dealId,
        unitId,
        applicantId,
        occupantIds: occupantIds.filter((x) => x !== applicantId),
        desiredMoveIn,
        submittedDocs,
        guarantorCompany: optStr(v.guarantorCompany),
        landlordCheck: lc,
        status,
      };
      if (statusChanged) {
        data.resultRecordedBy = isResult ? ctx.uid : null;
        data.resultRecordedAt = isResult ? nowIso() : null;
      }
      // 否決理由: 権限者のみ更新。権限がない場合は既存値を保持（画面には渡していない）
      if (sensitive) data.rejectReason = status === "rejected" ? optStr(v.rejectReason) : cur?.rejectReason ?? null;
      if (cur) {
        txUpdate(tx, ctx, C.applications, cur, ver(v), data);
        audit(tx, ctx, "update", C.applications, cur.id, { ...data, rejectReason: data.rejectReason ? "（非表示）" : undefined });
        return cur.id;
      }
      const nid = txCreate(tx, ctx, C.applications, {
        resultRecordedBy: null, resultRecordedAt: null, rejectReason: null, ...data,
      } as Omit<ApplicationDoc, keyof BaseDoc>);
      audit(tx, ctx, "create", C.applications, nid, { dealId, status });
      return nid;
    });
    if (status === "approved" || status === "rejected") {
      const deal = await getDoc<Deal>(ctx, C.deals, dealId);
      if (deal?.assigneeUid && deal.assigneeUid !== ctx.uid) {
        await notify(ctx, {
          toUid: deal.assigneeUid, kind: "application.result", title: `案件「${deal.title}」の申込み結果が記録されました`,
          href: `/deals/${dealId}?tab=applications`, dedupeKey: `application.result:${id}:${status}`,
        });
      }
    }
    return { redirect: `/deals/${dealId}?tab=applications` };
  });
}

export async function archiveApplication(input: Record<string, unknown>): Promise<ActionResult<{ redirect: string }>> {
  return run(async () => {
    const ctx = await requireStaff("deal.write");
    let dealId = "";
    await adminDb().runTransaction(async (tx) => {
      const cur = await txGet<ApplicationDoc>(tx, ctx, C.applications, str(input.id));
      const deal = await txGet<Deal>(tx, ctx, C.deals, cur.dealId);
      if (!canAccessStore(ctx, deal.storeId)) throw new ValidationError(["この店舗の案件を編集する権限がありません"]);
      dealId = deal.id;
      txUpdate(tx, ctx, C.applications, cur, null, { archived: true });
      audit(tx, ctx, "archive", C.applications, cur.id);
    });
    return { redirect: `/deals/${dealId}?tab=applications` };
  });
}
