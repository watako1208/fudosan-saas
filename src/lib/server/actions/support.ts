"use server";
import { adminDb } from "../firebase-admin";
import { requireStaff, canAccessStore, Ctx } from "../session";
import { run, str, optStr, ActionResult } from "../action";
import { ValidationError, txGet, txCreate, txUpdate, audit, keywords, txNextNumber, runOnce, getDoc, listDocs, findDocs, nowIso, BaseDoc } from "../repo";
import { notify } from "../notify";
import { C, Inquiry, Activity, Property, Unit, Party } from "@/lib/types";
import { isValidBizDate } from "@/lib/domain/dates";
import type { Cap } from "@/lib/permissions";

const CATEGORIES: Inquiry["category"][] = ["equipment", "noise", "leak", "key", "contract", "payment", "other"];
const URGENCIES: Inquiry["urgency"][] = ["low", "normal", "high", "emergency"];
const CHANNELS: Activity["channel"][] = ["phone", "visit", "email", "line", "letter", "viewing", "internal", "portal", "other"];

/** datetime-local（日本時間）→ ISO */
function jstLocalToIso(v: string): string | null {
  if (!v) return null;
  const s = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? `${v}:00+09:00` : v;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function resolveTarget(ctx: Ctx, propertyId: string | null, unitId: string | null, fe: Record<string, string>) {
  let unit: Unit | null = null;
  let property: Property | null = null;
  if (unitId) {
    unit = await getDoc<Unit>(ctx, C.units, unitId);
    if (!unit) fe.unitId = "部屋が見つかりません";
  }
  const pid = unit?.propertyId ?? propertyId;
  if (pid) {
    property = await getDoc<Property>(ctx, C.properties, pid);
    if (!property) fe.propertyId = "物件が見つかりません";
  }
  return { unit, property };
}

function inquiryFields(v: Record<string, unknown>) {
  const fe: Record<string, string> = {};
  const receivedAt = jstLocalToIso(str(v.receivedAt)) ?? (str(v.receivedAt) ? null : nowIso());
  if (!receivedAt) fe.receivedAt = "受付日時が正しくありません";
  const category = str(v.category) as Inquiry["category"];
  if (!CATEGORIES.includes(category)) fe.category = "分類を選択してください";
  const urgency = (str(v.urgency) || "normal") as Inquiry["urgency"];
  if (!URGENCIES.includes(urgency)) fe.urgency = "緊急度を選択してください";
  const content = str(v.content);
  if (!content) fe.content = "内容を入力してください";
  const due = optStr(v.due);
  if (due && !isValidBizDate(due)) fe.due = "期限は YYYY-MM-DD 形式で入力してください";
  const partyId = optStr(v.partyId);
  const partyName = optStr(v.partyName);
  if (!partyId && !partyName) fe.partyName = "相手（顧客・入居者など）を選択するか、名前を入力してください";
  return {
    fe,
    data: {
      receivedAt: receivedAt ?? nowIso(),
      category,
      urgency,
      content,
      due,
      partyId,
      partyName,
      propertyId: optStr(v.propertyId),
      unitId: optStr(v.unitId),
      assigneeUid: optStr(v.assigneeUid),
    },
  };
}

export async function createInquiry(v: Record<string, unknown>): Promise<ActionResult<{ redirect: string }>> {
  return run(async () => {
    const ctx = await requireStaff("repair.write");
    const { data, fe } = inquiryFields(v);
    const { unit, property } = await resolveTarget(ctx, data.propertyId, data.unitId, fe);
    let partyName = data.partyName;
    if (data.partyId) {
      const p = await getDoc<Party>(ctx, C.parties, data.partyId);
      if (!p) fe.partyId = "顧客が見つかりません";
      else partyName = p.name;
    }
    if (Object.keys(fe).length) throw new ValidationError(Object.values(fe), fe);
    const storeId = unit?.storeId ?? property?.storeId ?? optStr(v.storeId);
    if (!canAccessStore(ctx, storeId)) throw new ValidationError(["この店舗の問い合わせを登録する権限がありません"]);
    const id = await runOnce(ctx, str(v._requestId), async (tx) => {
      const number = await txNextNumber(tx, ctx, "inquiry", "Q");
      const id = txCreate(tx, ctx, C.inquiries, {
        ...data,
        partyName,
        propertyId: property?.id ?? null,
        unitId: unit?.id ?? null,
        number,
        status: "open",
        repairIds: [],
        storeId: storeId ?? null,
        source: "staff",
        keywords: keywords(number, partyName, property?.name, property?.address, unit?.number, data.content.slice(0, 60)),
      } satisfies Omit<Inquiry, keyof BaseDoc>);
      audit(tx, ctx, "create", C.inquiries, id, { number, category: data.category, urgency: data.urgency });
      return id;
    });
    if (data.assigneeUid && data.assigneeUid !== ctx.uid) {
      await notify(ctx, { toUid: data.assigneeUid, kind: "inquiry.assigned", title: `問い合わせの担当になりました（${partyName ?? ""}）`, href: `/support/${id}`, dedupeKey: `inquiry:${id}:assign:${data.assigneeUid}` });
    }
    return { redirect: `/support/${id}` };
  });
}

export async function updateInquiry(id: string, v: Record<string, unknown>): Promise<ActionResult<{ redirect: string }>> {
  return run(async () => {
    const ctx = await requireStaff("repair.write");
    const { data, fe } = inquiryFields(v);
    const { unit, property } = await resolveTarget(ctx, data.propertyId, data.unitId, fe);
    let partyName = data.partyName;
    if (data.partyId) {
      const p = await getDoc<Party>(ctx, C.parties, data.partyId);
      if (!p) fe.partyId = "顧客が見つかりません";
      else partyName = p.name;
    }
    if (Object.keys(fe).length) throw new ValidationError(Object.values(fe), fe);
    let prevAssignee: string | null = null;
    await adminDb().runTransaction(async (tx) => {
      const cur = await txGet<Inquiry>(tx, ctx, C.inquiries, id);
      if (!canAccessStore(ctx, cur.storeId)) throw new ValidationError(["この店舗の問い合わせを編集する権限がありません"]);
      prevAssignee = cur.assigneeUid;
      if (cur.assigneeUid !== data.assigneeUid && !ctx.caps.has("assignee.change") && cur.assigneeUid && cur.assigneeUid !== ctx.uid) {
        throw new ValidationError(["担当者を変更する権限がありません"], { assigneeUid: "担当変更は店舗責任者以上が行えます" });
      }
      const patch = {
        ...data,
        partyName,
        propertyId: property?.id ?? null,
        unitId: unit?.id ?? null,
        storeId: unit?.storeId ?? property?.storeId ?? cur.storeId,
        keywords: keywords(cur.number, partyName, property?.name, property?.address, unit?.number, data.content.slice(0, 60)),
      };
      txUpdate(tx, ctx, C.inquiries, cur, v._version === null || v._version === undefined ? null : Number(v._version), patch);
      audit(tx, ctx, "update", C.inquiries, id, { category: data.category, urgency: data.urgency, due: data.due, assigneeUid: data.assigneeUid });
    });
    if (data.assigneeUid && data.assigneeUid !== prevAssignee && data.assigneeUid !== ctx.uid) {
      await notify(ctx, { toUid: data.assigneeUid, kind: "inquiry.assigned", title: `問い合わせの担当になりました（${partyName ?? ""}）`, href: `/support/${id}`, dedupeKey: `inquiry:${id}:assign:${data.assigneeUid}` });
    }
    return { redirect: `/support/${id}` };
  });
}

export async function setInquiryStatus(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff("repair.write");
    const id = str(input.id);
    const status = str(input.status) as Inquiry["status"];
    if (!["open", "in_progress", "done"].includes(status)) throw new ValidationError(["状態が不正です"]);
    await adminDb().runTransaction(async (tx) => {
      const cur = await txGet<Inquiry>(tx, ctx, C.inquiries, id);
      if (!canAccessStore(ctx, cur.storeId)) throw new ValidationError(["権限がありません"]);
      txUpdate(tx, ctx, C.inquiries, cur, null, { status });
      audit(tx, ctx, "status", C.inquiries, id, { before: cur.status, after: status, reason: optStr(input.reason) });
    });
    return null;
  });
}

/** 対応記録の追記（外部への送信は行わない。外部で行った対応の記録） */
export async function addActivity(v: Record<string, unknown>): Promise<ActionResult<{ redirect?: string } | null>> {
  return run(async () => {
    const ctx = await requireStaff("repair.write");
    const entity = str(v.entity) as "inquiry" | "repair";
    const entityId = str(v.entityId);
    if (!["inquiry", "repair"].includes(entity)) throw new ValidationError(["対象が不正です"]);
    const fe: Record<string, string> = {};
    const channel = str(v.channel) as Activity["channel"];
    if (!CHANNELS.includes(channel)) fe.channel = "手段を選択してください";
    const direction = (["in", "out", "none"].includes(str(v.direction)) ? str(v.direction) : "none") as Activity["direction"];
    const summary = str(v.summary);
    if (!summary) fe.summary = "対応内容を入力してください";
    const at = jstLocalToIso(str(v.at)) ?? nowIso();
    if (Object.keys(fe).length) throw new ValidationError(Object.values(fe), fe);
    await runOnce(ctx, str(v._requestId), async (tx) => {
      const col = entity === "inquiry" ? C.inquiries : C.repairs;
      const target = await txGet<BaseDoc & { storeId: string | null; status: string }>(tx, ctx, col, entityId);
      if (!canAccessStore(ctx, target.storeId)) throw new ValidationError(["権限がありません"]);
      const id = txCreate(tx, ctx, C.activities, {
        entity, entityId, channel, direction, at, summary: summary.slice(0, 200), body: optStr(v.body), byUid: ctx.uid,
      } satisfies Omit<Activity, keyof BaseDoc>);
      if (entity === "inquiry" && target.status === "open") txUpdate(tx, ctx, col, target, null, { status: "in_progress" });
      audit(tx, ctx, "activity.add", col, entityId, { activityId: id, channel, summary });
      return id;
    });
    return null;
  });
}

/** 入力補助: 関係データの検索（各データの閲覧権限が必要） */
export async function pickerSearch(kind: "party" | "property" | "vendor", q: string): Promise<{ value: string; label: string; sub?: string }[]> {
  const capFor: Record<string, Cap> = { party: "party.read", vendor: "party.read", property: "property.read" };
  const ctx = await requireStaff(capFor[kind]);
  const query = str(q);
  if (!query) return [];
  if (kind === "party" || kind === "vendor") {
    const p = await listDocs<Party>(ctx, C.parties, { search: query, pageSize: 25, where: kind === "vendor" ? [["roles", "array-contains", "vendor"]] : [] });
    return p.items.map((x) => ({ value: x.id, label: `${x.name}（${x.number}）`, sub: x.address ?? undefined }));
  }
  const p = await listDocs<Property>(ctx, C.properties, { search: query, pageSize: 25 });
  return p.items.filter((x) => canAccessStore(ctx, x.storeId)).map((x) => ({ value: x.id, label: `${x.name}（${x.number}）`, sub: x.address ?? undefined }));
}

/** 物件の部屋一覧（入力補助） */
export async function unitsOfProperty(propertyId: string): Promise<{ value: string; label: string }[]> {
  const ctx = await requireStaff("property.read");
  if (!str(propertyId)) return [];
  const units = await findDocs<Unit>(ctx, C.units, [["propertyId", "==", str(propertyId)]], 1000);
  return units
    .filter((u) => !u.archived)
    .sort((a, b) => a.number.localeCompare(b.number, "ja", { numeric: true }))
    .map((u) => ({ value: u.id, label: u.number }));
}
