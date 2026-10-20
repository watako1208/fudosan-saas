import "server-only";
import { adminDb } from "../firebase-admin";
import { systemCtx } from "../session";
import { col, getMany, nowIso, audit } from "../repo";
import { notify } from "../notify";
import { addDays } from "@/lib/domain/dates";
import { C, TaskDoc, Inquiry, Renewal, Contract } from "@/lib/types";

// 定期処理: 期限の通知作成。dedupeKey により再実行しても重複作成しない。

const MAX = 2000;

/** notify() と同じ規則の通知ID */
function notificationId(dedupeKey: string, toUid: string) {
  return `${dedupeKey}__${toUid}`.replace(/\//g, "_").slice(0, 400);
}

/**
 * 期限超過タスク・期限を過ぎた未完了の問い合わせ・案内期限が14日以内の更新対象について通知を作成する。
 * 戻り値の created は新規に作成された通知の件数（既存の通知は数えない）。
 */
export async function createDeadlineNotifications(companyId: string, today: string): Promise<{ created: number }> {
  const ctx = systemCtx(companyId);
  const planned: { toUid: string; kind: string; title: string; href: string; dedupeKey: string }[] = [];

  // 期限超過タスク
  const tasks = await col(companyId, C.tasks).where("done", "==", false).where("due", "<", today).limit(MAX).get();
  for (const d of tasks.docs) {
    const t = { ...(d.data() as TaskDoc), id: d.id };
    if (t.archived || !t.assigneeUid) continue;
    planned.push({ toUid: t.assigneeUid, kind: "task.overdue", title: `期限超過のタスク: ${t.title}（期限 ${t.due}）`, href: "/schedule/tasks?overdue=1", dedupeKey: `task:${t.id}:overdue` });
  }

  // 期限を過ぎた未完了の問い合わせ
  const inq = await col(companyId, C.inquiries).where("status", "in", ["open", "in_progress"]).where("due", "<", today).limit(MAX).get();
  for (const d of inq.docs) {
    const i = { ...(d.data() as Inquiry), id: d.id };
    if (i.archived || !i.assigneeUid) continue;
    planned.push({ toUid: i.assigneeUid, kind: "inquiry.overdue", title: `対応期限を過ぎた問い合わせ: ${i.number}（${i.partyName ?? ""}）`, href: `/support/${i.id}`, dedupeKey: `inquiry:${i.id}:overdue` });
  }

  // 更新案内期限が14日以内（契約担当へ）
  const ren = await col(companyId, C.renewals)
    .where("status", "in", ["extracted", "notified"])
    .where("noticeDeadline", ">=", today)
    .where("noticeDeadline", "<=", addDays(today, 14))
    .limit(MAX)
    .get();
  const renewals = ren.docs.map((d) => ({ ...(d.data() as Renewal), id: d.id })).filter((r) => !r.archived);
  const contracts = await getMany<Contract>(ctx, C.contracts, renewals.map((r) => r.contractId));
  for (const r of renewals) {
    const c = contracts.get(r.contractId);
    if (!c?.assigneeUid) continue;
    planned.push({ toUid: c.assigneeUid, kind: "renewal.notice", title: `更新案内期限が近づいています: ${c.number}（期限 ${r.noticeDeadline}）`, href: "/lease?tab=renewals", dedupeKey: `renewal:${r.id}:notice` });
  }

  if (!planned.length) return { created: 0 };
  // 既存の通知を確認して新規分だけ作成する
  const refs = planned.map((p) => col(companyId, C.notifications).doc(notificationId(p.dedupeKey, p.toUid)));
  const existing = new Set<string>();
  for (let i = 0; i < refs.length; i += 300) {
    const snaps = await adminDb().getAll(...refs.slice(i, i + 300));
    snaps.forEach((s) => s.exists && existing.add(s.id));
  }
  let created = 0;
  for (const p of planned) {
    if (existing.has(notificationId(p.dedupeKey, p.toUid))) continue;
    await notify(ctx, p);
    created++;
  }
  return { created };
}

/**
 * 適用開始日が到来した会社設定・費目変更を反映する（設定画面で予約されたもの）。
 * 定期処理（/api/jobs）から1日1回呼び出す。再実行しても状態 scheduled のものだけを処理するため二重適用しない。
 */
export async function applyScheduledSettings(companyId: string, today: string): Promise<{ applied: number }> {
  const ctx = systemCtx(companyId);
  const db = adminDb();
  let applied = 0;
  const hist = await col(companyId, "settingsHistory").where("status", "==", "scheduled").where("effectiveFrom", "<=", today).orderBy("effectiveFrom").limit(50).get();
  for (const h of hist.docs) {
    await db.runTransaction(async (tx) => {
      const s = await tx.get(h.ref);
      if (s.data()?.status !== "scheduled") return;
      const v = s.data()!.settings as Record<string, unknown>;
      tx.update(db.collection("companies").doc(companyId), {
        "settings.taxRounding": v.taxRounding,
        "settings.lineRounding": v.lineRounding,
        "settings.defaultProration": v.defaultProration,
        "settings.fileMaxMB": v.fileMaxMB,
        "settings.fileMaxCount": v.fileMaxCount,
        "settings.effectiveFrom": s.data()!.effectiveFrom,
        updatedAt: nowIso(),
      });
      tx.update(h.ref, { status: "applied", appliedAt: nowIso() });
      audit(tx, ctx, "settings.apply", "companies", companyId, { historyId: h.id });
      applied++;
    });
  }
  const vers = await col(companyId, "itemTypeVersions").where("status", "==", "scheduled").where("effectiveFrom", "<=", today).orderBy("effectiveFrom").limit(100).get();
  for (const vd of vers.docs) {
    await db.runTransaction(async (tx) => {
      const s = await tx.get(vd.ref);
      const data = s.data();
      if (data?.status !== "scheduled") return;
      const itRef = col(companyId, C.itemTypes).doc(data.code);
      const it = await tx.get(itRef);
      if (!it.exists) return;
      tx.update(itRef, { ...data.next, scheduledChange: null, updatedAt: nowIso(), updatedBy: "system", version: (it.data()!.version ?? 0) + 1 });
      tx.update(vd.ref, { status: "applied", appliedAt: nowIso(), snapshot: { name: it.data()!.name, tax: it.data()!.tax, proration: it.data()!.proration, managementFeeTarget: it.data()!.managementFeeTarget, effectiveFrom: it.data()!.effectiveFrom } });
      audit(tx, ctx, "itemType.apply", C.itemTypes, data.code, { versionId: vd.id });
      applied++;
    });
  }
  return { applied };
}
