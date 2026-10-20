"use server";
import { adminDb } from "../firebase-admin";
import { requireStaff, canAccessStore } from "../session";
import { run, str, optStr, ActionResult } from "../action";
import { ValidationError, txGet, txCreate, txUpdate, audit, runOnce, findDocs, getDoc, nowIso, BaseDoc } from "../repo";
import { notify } from "../notify";
import { staffList } from "../lookups";
import { C, EventDoc, TaskDoc, Deal, Property } from "@/lib/types";
import { isValidBizDate } from "@/lib/domain/dates";
import { jstLocalToIso, findOverlaps, jstTime, jstDateOf } from "@/lib/domain/deals";

const TYPES: EventDoc["type"][] = ["viewing", "meeting", "inspection", "move_in", "move_out", "settlement", "construction", "other"];

function ver(v: Record<string, unknown>): number | null {
  return v._version === null || v._version === undefined || v._version === "" ? null : Number(v._version);
}

function eventFields(v: Record<string, unknown>) {
  const fe: Record<string, string> = {};
  const title = str(v.title);
  if (!title) fe.title = "件名を入力してください";
  const type = str(v.type) as EventDoc["type"];
  if (!TYPES.includes(type)) fe.type = "種類を選択してください";
  const start = jstLocalToIso(str(v.start));
  const end = jstLocalToIso(str(v.end));
  if (!start) fe.start = "開始日時を入力してください";
  if (!end) fe.end = "終了日時を入力してください";
  if (start && end && end <= start) fe.end = "終了日時は開始日時より後にしてください";
  const tm = str(v.travelMinutes);
  const travelMinutes = tm === "" ? null : Number(tm);
  if (travelMinutes !== null && (!Number.isInteger(travelMinutes) || travelMinutes < 0 || travelMinutes > 600)) fe.travelMinutes = "0〜600の整数（分）で入力してください";
  return {
    fe,
    data: {
      title,
      type,
      start: start ?? "",
      end: end ?? "",
      assigneeUid: optStr(v.assigneeUid),
      partyId: optStr(v.partyId),
      propertyId: optStr(v.propertyId),
      unitId: optStr(v.unitId),
      dealId: optStr(v.dealId),
      place: optStr(v.place),
      keyPickup: optStr(v.keyPickup),
      travelMinutes,
      result: optStr(v.result),
      done: v.done === true || v.done === "true" || v.done === "on",
    },
  };
}

/**
 * 予定の保存。同じ担当者の予定と時間が重なる（移動時間を前後に含む）場合は警告し、
 * 利用者が「重複を承知で保存」（_intent=force）を選んだときだけ保存する。外部カレンダーとは同期しない。
 */
export async function saveEvent(id: string | null, v: Record<string, unknown>): Promise<ActionResult<{ redirect: string }>> {
  return run(async () => {
    const ctx = await requireStaff("schedule.write");
    const { data, fe } = eventFields(v);
    if (Object.keys(fe).length) throw new ValidationError(Object.values(fe), fe);
    // 関連先の確認と店舗
    let storeId: string | null = null;
    if (data.dealId) {
      const d = await getDoc<Deal>(ctx, C.deals, data.dealId);
      if (!d) throw new ValidationError(["関連する案件が見つかりません"]);
      if (!canAccessStore(ctx, d.storeId)) throw new ValidationError(["この店舗の案件の予定は登録できません"]);
      storeId = d.storeId;
    }
    if (data.propertyId) {
      const p = await getDoc<Property>(ctx, C.properties, data.propertyId);
      if (!p) throw new ValidationError(["物件が見つかりません"], { propertyId: "物件を選び直してください" });
      storeId = storeId ?? p.storeId;
    }
    if (data.partyId && !(await getDoc(ctx, C.parties, data.partyId))) throw new ValidationError(["顧客が見つかりません"], { partyId: "顧客を選び直してください" });
    // 重複の警告
    if (data.assigneeUid && str(v._intent) !== "force") {
      const from = new Date(Date.parse(data.start) - 24 * 3600000).toISOString();
      const to = new Date(Date.parse(data.end) + 12 * 3600000).toISOString(); // 後続予定の移動時間も確認
      const near = (await findDocs<EventDoc>(ctx, C.events, [["assigneeUid", "==", data.assigneeUid], ["start", ">=", from], ["start", "<", to]], 200)).filter((e) => !e.archived);
      const w = findOverlaps({ id: id ?? undefined, start: data.start, end: data.end, travelMinutes: data.travelMinutes }, near);
      if (w.length) {
        throw new ValidationError([
          `担当者の予定と重なっています（${w.length}件）`,
          ...w.map((x) => `${jstDateOf(x.event.start)} ${jstTime(x.event.start)}〜${jstTime(x.event.end)}「${x.event.title}」: ${x.kind === "overlap" ? "時間が重複" : `移動時間（${Math.max(x.event.travelMinutes ?? 0, data.travelMinutes ?? 0)}分）を確保できません`}`),
          "このまま登録する場合は「重複を承知で保存」を押してください。",
        ]);
      }
    }
    const eid = await runOnce(ctx, str(v._requestId), async (tx) => {
      if (id) {
        const cur = await txGet<EventDoc>(tx, ctx, C.events, id);
        if (!canAccessStore(ctx, cur.storeId)) throw new ValidationError(["この店舗の予定を編集する権限がありません"]);
        txUpdate(tx, ctx, C.events, cur, ver(v), { ...data, storeId: storeId ?? cur.storeId });
        audit(tx, ctx, "update", C.events, id, { ...data, overlapConfirmed: str(v._intent) === "force" });
        return id;
      }
      const nid = txCreate(tx, ctx, C.events, { ...data, storeId: storeId ?? ctx.user.storeIds[0] ?? null } satisfies Omit<EventDoc, keyof BaseDoc>);
      audit(tx, ctx, "create", C.events, nid, { ...data, overlapConfirmed: str(v._intent) === "force" });
      return nid;
    });
    if (data.assigneeUid && data.assigneeUid !== ctx.uid) {
      await notify(ctx, {
        toUid: data.assigneeUid, kind: "event.assigned", title: `予定「${data.title}」（${jstDateOf(data.start)} ${jstTime(data.start)}）が登録されました`,
        href: `/schedule/${eid}`, dedupeKey: `event.assigned:${eid}:${data.start}:${data.assigneeUid}`,
      });
    }
    const back = optStr(v._back);
    return { redirect: back && back.startsWith("/") && !back.startsWith("//") ? back : `/schedule/${eid}` };
  });
}

/** 内見記録（スマートフォンから実施結果を記録）。案件の予定なら案件の対応記録にも残す */
export async function recordEventResult(id: string, v: Record<string, unknown>): Promise<ActionResult<{ redirect: string }>> {
  return run(async () => {
    const ctx = await requireStaff("schedule.write");
    const result = optStr(v.result);
    if (!result) throw new ValidationError(["実施結果を入力してください"], { result: "実施結果を入力してください" });
    await runOnce(ctx, str(v._requestId), async (tx) => {
      const cur = await txGet<EventDoc>(tx, ctx, C.events, id);
      if (!canAccessStore(ctx, cur.storeId)) throw new ValidationError(["この店舗の予定を編集する権限がありません"]);
      const deal = cur.dealId && ctx.caps.has("deal.write") ? await txGet<Deal>(tx, ctx, C.deals, cur.dealId) : null;
      txUpdate(tx, ctx, C.events, cur, ver(v), { result, done: true });
      if (deal) {
        txCreate(tx, ctx, C.activities, {
          entity: "deal", entityId: deal.id, channel: "viewing", direction: "none", at: nowIso(),
          summary: `${cur.type === "viewing" ? "内見" : "予定"}実施: ${cur.title}`, body: result, byUid: ctx.uid,
        });
      }
      audit(tx, ctx, "event.result", C.events, id, { result });
      return null;
    });
    return { redirect: `/schedule/${id}` };
  });
}

export async function archiveEvent(input: Record<string, unknown>): Promise<ActionResult<{ redirect: string }>> {
  return run(async () => {
    const ctx = await requireStaff("schedule.write");
    const id = str(input.id);
    await adminDb().runTransaction(async (tx) => {
      const cur = await txGet<EventDoc>(tx, ctx, C.events, id);
      if (!canAccessStore(ctx, cur.storeId)) throw new ValidationError(["この店舗の予定を編集する権限がありません"]);
      txUpdate(tx, ctx, C.events, cur, null, { archived: !cur.archived });
      audit(tx, ctx, cur.archived ? "unarchive" : "archive", C.events, id);
    });
    return { redirect: `/schedule?view=week&date=${input.date ?? ""}` };
  });
}

// ───────────── タスク ─────────────

export async function saveTask(id: string | null, v: Record<string, unknown>): Promise<ActionResult<{ redirect: string }>> {
  return run(async () => {
    const ctx = await requireStaff("schedule.write");
    const fe: Record<string, string> = {};
    const title = str(v.title);
    if (!title) fe.title = "件名を入力してください";
    const due = str(v.due);
    if (!isValidBizDate(due)) fe.due = "期限を入力してください";
    const entity = optStr(v.entity);
    const entityId = entity ? optStr(v.entityId) : null;
    if (entity && !["deal", "party", "property", "contract"].includes(entity)) fe.entity = "関連先が正しくありません";
    if (Object.keys(fe).length) throw new ValidationError(Object.values(fe), fe);
    const assigneeUid = optStr(v.assigneeUid);
    if (assigneeUid && !(await staffList(ctx.companyId)).some((s) => s.uid === assigneeUid)) throw new ValidationError(["担当者が見つかりません"], { assigneeUid: "担当者を選び直してください" });
    let storeId: string | null = null;
    if (entity && entityId) {
      const colName = { deal: C.deals, party: C.parties, property: C.properties, contract: C.contracts }[entity]!;
      const t = await getDoc<BaseDoc & { storeId?: string | null }>(ctx, colName, entityId);
      if (!t) throw new ValidationError(["関連先が見つかりません"]);
      if (!canAccessStore(ctx, t.storeId)) throw new ValidationError(["この店舗のデータにタスクを登録する権限がありません"]);
      storeId = t.storeId ?? null;
    }
    const tid = await runOnce(ctx, str(v._requestId), async (tx) => {
      if (id) {
        const cur = await txGet<TaskDoc>(tx, ctx, C.tasks, id);
        if (!canAccessStore(ctx, cur.storeId)) throw new ValidationError(["この店舗のタスクを編集する権限がありません"]);
        txUpdate(tx, ctx, C.tasks, cur, ver(v), { title, due, assigneeUid, entity, entityId, storeId: storeId ?? cur.storeId });
        audit(tx, ctx, "update", C.tasks, id, { title, due, assigneeUid });
        return id;
      }
      const nid = txCreate(tx, ctx, C.tasks, {
        title, due, assigneeUid, entity, entityId, done: false, doneBy: null, doneAt: null, storeId: storeId ?? ctx.user.storeIds[0] ?? null, sourceKey: null,
      } satisfies Omit<TaskDoc, keyof BaseDoc>);
      audit(tx, ctx, "create", C.tasks, nid, { title, due, assigneeUid });
      return nid;
    });
    if (assigneeUid && assigneeUid !== ctx.uid) {
      await notify(ctx, { toUid: assigneeUid, kind: "task.assigned", title: `タスク「${title}」（期限 ${due}）`, href: `/schedule/tasks`, dedupeKey: `task.assigned:${tid}:${assigneeUid}` });
    }
    const back = optStr(v._back);
    return { redirect: back && back.startsWith("/") && !back.startsWith("//") ? back : "/schedule/tasks" };
  });
}

/** 完了・未完了の切替（完了者・完了日時を記録） */
export async function toggleTask(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff("schedule.write");
    await adminDb().runTransaction(async (tx) => {
      const cur = await txGet<TaskDoc>(tx, ctx, C.tasks, str(input.id));
      if (!canAccessStore(ctx, cur.storeId)) throw new ValidationError(["この店舗のタスクを編集する権限がありません"]);
      const done = !cur.done;
      txUpdate(tx, ctx, C.tasks, cur, null, done ? { done, doneBy: ctx.uid, doneAt: nowIso() } : { done, doneBy: null, doneAt: null });
      audit(tx, ctx, done ? "task.done" : "task.undone", C.tasks, cur.id, { title: cur.title });
    });
    return null;
  });
}

export async function archiveTask(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff("schedule.write");
    await adminDb().runTransaction(async (tx) => {
      const cur = await txGet<TaskDoc>(tx, ctx, C.tasks, str(input.id));
      if (!canAccessStore(ctx, cur.storeId)) throw new ValidationError(["この店舗のタスクを編集する権限がありません"]);
      txUpdate(tx, ctx, C.tasks, cur, null, { archived: true });
      audit(tx, ctx, "archive", C.tasks, cur.id, { title: cur.title });
    });
    return null;
  });
}
