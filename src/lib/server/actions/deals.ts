"use server";
import type { Transaction } from "firebase-admin/firestore";
import { adminDb } from "../firebase-admin";
import { requireStaff, canAccessStore, Ctx } from "../session";
import { run, str, optStr, optYen, ActionResult } from "../action";
import { ValidationError, txGet, txCreate, txUpdate, audit, keywords, txNextNumber, runOnce, col, ref, getMany, BaseDoc } from "../repo";
import { notify } from "../notify";
import { C, Deal, PartyRole, PartyRoleKind, Property, Unit, Contract, Activity, TaskDoc } from "@/lib/types";
import type { PartyExt } from "@/lib/types-deals";
import { RENTAL_DEAL_STATUSES, SALE_DEAL_STATUSES, validateDealTransition, labelOf } from "@/lib/domain/rules";
import { isValidBizDate, todayJst, addDays } from "@/lib/domain/dates";
import { aggregateRoles, jstLocalToIso } from "@/lib/domain/deals";
import { REQUIRED_DOCS } from "@/lib/labels-deals";

function ver(v: Record<string, unknown>): number | null {
  return v._version === null || v._version === undefined || v._version === "" ? null : Number(v._version);
}

const statusesOf = (kind: Deal["kind"]) => (kind === "sale" ? SALE_DEAL_STATUSES : RENTAL_DEAL_STATUSES);

/** 案件の顧客に付与する役割 */
function customerRole(kind: Deal["kind"], side: Deal["side"]): PartyRoleKind {
  if (kind === "rental") return side === "landlord" ? "lessor" : "prospect_tenant";
  return side === "seller" ? "seller" : "prospect_buyer";
}

async function txRoleRecords(tx: Transaction, ctx: Ctx, partyIds: string[]): Promise<PartyRole[]> {
  const ids = [...new Set(partyIds.filter(Boolean))];
  const out: PartyRole[] = [];
  for (let i = 0; i < ids.length; i += 30) {
    const snap = await tx.get(col(ctx.companyId, C.partyRoles).where("partyId", "in", ids.slice(i, i + 30)));
    snap.docs.forEach((d) => out.push({ ...(d.data() as PartyRole), id: d.id }));
  }
  return out;
}

function syncRoles(tx: Transaction, ctx: Ctx, party: PartyExt, records: PartyRole[]) {
  const manual = party.manualRoles ?? [];
  const base = party.corporationId ? [...manual, "contact_person" as PartyRoleKind] : manual;
  const roles = aggregateRoles(base, records.filter((r) => r.partyId === party.id), todayJst());
  if (JSON.stringify(roles) !== JSON.stringify([...(party.roles ?? [])].sort())) txUpdate(tx, ctx, C.parties, party, null, { roles });
}

function parseTargets(raw: unknown): { propertyId: string; unitId: string | null }[] {
  if (!raw) return [];
  try {
    const a = JSON.parse(String(raw)) as { propertyId: string; unitId: string | null }[];
    return a.filter((x) => x && typeof x.propertyId === "string" && x.propertyId).map((x) => ({ propertyId: x.propertyId, unitId: x.unitId || null }));
  } catch {
    return [];
  }
}

function dealFields(v: Record<string, unknown>, kindFixed?: Deal["kind"]) {
  const fe: Record<string, string> = {};
  const kind = (kindFixed ?? str(v.kind)) as Deal["kind"];
  if (!["rental", "sale"].includes(kind)) fe.kind = "賃貸・売買を選択してください";
  const sideRaw = optStr(v.side) as Deal["side"];
  const sides = kind === "sale" ? ["seller", "buyer"] : ["tenant", "landlord"];
  if (sideRaw && !sides.includes(sideRaw)) fe.side = "案件種別が正しくありません";
  if (kind === "sale" && !sideRaw) fe.side = "売買では売主側・買主側を選択してください";
  const title = str(v.title);
  if (!title) fe.title = "案件名を入力してください";
  const nextActionDate = optStr(v.nextActionDate);
  if (nextActionDate && !isValidBizDate(nextActionDate)) fe.nextActionDate = "日付が正しくありません";
  const expectedAmount = optYen(v.expectedAmount, "expectedAmount", fe);
  const targets = parseTargets(v.targets);
  return {
    fe,
    targets,
    data: {
      kind,
      side: sideRaw ?? (kind === "rental" ? "tenant" : null),
      title,
      customerId: optStr(v.customerId),
      assigneeUid: optStr(v.assigneeUid),
      storeId: optStr(v.storeId),
      expectedAmount,
      nextActionDate,
      nextAction: optStr(v.nextAction),
      conditions: optStr(v.conditions),
    },
  };
}

async function resolveTargets(ctx: Ctx, targets: { propertyId: string; unitId: string | null }[]) {
  const props = await getMany<Property>(ctx, C.properties, targets.map((t) => t.propertyId));
  const units = await getMany<Unit>(ctx, C.units, targets.map((t) => t.unitId ?? "").filter(Boolean));
  for (const t of targets) {
    if (!props.has(t.propertyId)) throw new ValidationError(["対象物件が見つかりません"], { targets: "対象物件を選び直してください" });
    if (t.unitId && units.get(t.unitId)?.propertyId !== t.propertyId) throw new ValidationError(["部屋・区画が物件に属していません"], { targets: "部屋を選び直してください" });
  }
  return {
    propertyIds: [...new Set(targets.map((t) => t.propertyId))],
    unitIds: [...new Set(targets.map((t) => t.unitId).filter((x): x is string => !!x))],
    names: [...props.values()].map((p) => p.name),
  };
}

export async function createDeal(v: Record<string, unknown>): Promise<ActionResult<{ redirect: string }>> {
  return run(async () => {
    const ctx = await requireStaff("deal.write");
    const { data, fe, targets } = dealFields(v);
    if (Object.keys(fe).length) throw new ValidationError(Object.values(fe), fe);
    if (!canAccessStore(ctx, data.storeId)) throw new ValidationError(["この店舗に登録する権限がありません"], { storeId: "権限のない店舗です" });
    const t = await resolveTargets(ctx, targets);
    const id = await runOnce(ctx, str(v._requestId), async (tx) => {
      // 読込み（採番の前に完了させる）
      const customer = data.customerId ? await txGet<PartyExt>(tx, ctx, C.parties, data.customerId) : null;
      const records = customer ? await txRoleRecords(tx, ctx, [customer.id]) : [];
      const number = await txNextNumber(tx, ctx, "deal", "D");
      // 書込み
      const status = statusesOf(data.kind)[0][0];
      const dealRef = col(ctx.companyId, C.deals).doc();
      txCreate(tx, ctx, C.deals, {
        ...data,
        number,
        status,
        propertyIds: t.propertyIds,
        unitIds: t.unitIds,
        contractId: null,
        lostReason: null,
        keywords: keywords(number, data.title, customer?.name, customer?.kana, ...t.names),
      } satisfies Omit<Deal, keyof BaseDoc>, dealRef.id);
      if (customer) {
        const rec = { partyId: customer.id, role: customerRole(data.kind, data.side), entity: "deal" as const, entityId: dealRef.id, from: todayJst(), to: null };
        const rid = txCreate(tx, ctx, C.partyRoles, rec);
        syncRoles(tx, ctx, customer, [...records, { ...rec, id: rid, archived: false } as PartyRole]);
        if (customer.supportStatus === "none" || customer.supportStatus === "done") txUpdate(tx, ctx, C.parties, customer, null, { supportStatus: "in_progress" });
      }
      audit(tx, ctx, "create", C.deals, dealRef.id, { number, title: data.title, kind: data.kind });
      return dealRef.id;
    });
    if (data.assigneeUid && data.assigneeUid !== ctx.uid) {
      await notify(ctx, { toUid: data.assigneeUid, kind: "deal.assigned", title: `仲介案件「${data.title}」の担当になりました`, href: `/deals/${id}`, dedupeKey: `deal.assigned:${id}:${data.assigneeUid}` });
    }
    return { redirect: `/deals/${id}` };
  });
}

export async function updateDeal(id: string, v: Record<string, unknown>): Promise<ActionResult<{ redirect: string }>> {
  return run(async () => {
    const ctx = await requireStaff("deal.write");
    const kind = str(v.kind) as Deal["kind"];
    const { data, fe, targets } = dealFields(v, kind);
    if (Object.keys(fe).length) throw new ValidationError(Object.values(fe), fe);
    const t = await resolveTargets(ctx, targets);
    let assigneeChanged = false;
    await adminDb().runTransaction(async (tx) => {
      const cur = await txGet<Deal>(tx, ctx, C.deals, id);
      if (!canAccessStore(ctx, cur.storeId) || !canAccessStore(ctx, data.storeId)) throw new ValidationError(["この店舗の案件を編集する権限がありません"]);
      if (cur.kind !== data.kind) throw new ValidationError(["賃貸・売買の区分は変更できません。新しい案件を作成してください"]);
      if (cur.assigneeUid !== data.assigneeUid && !ctx.caps.has("assignee.change") && cur.assigneeUid && cur.assigneeUid !== ctx.uid) {
        throw new ValidationError(["担当者を変更する権限がありません"], { assigneeUid: "担当変更は店舗責任者以上が行えます" });
      }
      const custChanged = cur.customerId !== data.customerId || cur.side !== data.side;
      const oldCust = custChanged && cur.customerId ? await txGet<PartyExt>(tx, ctx, C.parties, cur.customerId) : null;
      const newCust = data.customerId ? await txGet<PartyExt>(tx, ctx, C.parties, data.customerId) : null;
      const records = custChanged ? await txRoleRecords(tx, ctx, [cur.customerId ?? "", data.customerId ?? ""]) : [];
      assigneeChanged = cur.assigneeUid !== data.assigneeUid;
      txUpdate(tx, ctx, C.deals, cur, ver(v), {
        ...data,
        propertyIds: t.propertyIds,
        unitIds: t.unitIds,
        keywords: keywords(cur.number, data.title, newCust?.name, newCust?.kana, ...t.names),
      });
      if (custChanged) {
        const next = [...records];
        const oldRole = customerRole(cur.kind, cur.side);
        for (const r of records) {
          if (r.partyId === cur.customerId && r.entity === "deal" && r.entityId === id && r.role === oldRole && !r.archived) {
            txUpdate(tx, ctx, C.partyRoles, r, null, { archived: true });
            next[next.findIndex((x) => x.id === r.id)] = { ...r, archived: true };
          }
        }
        if (newCust) {
          const rec = { partyId: newCust.id, role: customerRole(data.kind, data.side), entity: "deal" as const, entityId: id, from: todayJst(), to: null };
          if (!next.some((x) => x.partyId === rec.partyId && x.role === rec.role && x.entity === "deal" && x.entityId === id && !x.archived)) {
            const rid = txCreate(tx, ctx, C.partyRoles, rec);
            next.push({ ...rec, id: rid, archived: false } as PartyRole);
          }
          syncRoles(tx, ctx, newCust, next);
        }
        if (oldCust && oldCust.id !== newCust?.id) syncRoles(tx, ctx, oldCust, next);
      }
      audit(tx, ctx, "update", C.deals, id, data);
    });
    if (assigneeChanged && data.assigneeUid && data.assigneeUid !== ctx.uid) {
      await notify(ctx, { toUid: data.assigneeUid, kind: "deal.assigned", title: `仲介案件「${data.title}」の担当になりました`, href: `/deals/${id}`, dedupeKey: `deal.assigned:${id}:${data.assigneeUid}` });
    }
    return { redirect: `/deals/${id}` };
  });
}

/** 進行状態の変更。validateDealTransition で必要項目を検証し、成約には契約の確定が必要 */
export async function changeDealStatus(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff("deal.write");
    const id = str(input.id);
    const to = str(input.to);
    const reason = optStr(input.lostReason) ?? optStr(input.reason);
    await adminDb().runTransaction(async (tx) => {
      const deal = await txGet<Deal>(tx, ctx, C.deals, id);
      if (!canAccessStore(ctx, deal.storeId)) throw new ValidationError(["この店舗の案件を編集する権限がありません"]);
      if (!statusesOf(deal.kind).some(([k]) => k === to)) throw new ValidationError(["進行状態が正しくありません"]);
      if (deal.status === to) throw new ValidationError(["既にその進行状態です"]);
      // 関連契約の状態（deal.contractId、または dealId で関連づけられた契約）
      const statuses: string[] = [];
      if (deal.contractId) {
        const c = await tx.get(ref(ctx, C.contracts, deal.contractId));
        if (c.exists && c.data()!.companyId === ctx.companyId) statuses.push(String(c.data()!.status));
      }
      const linked = await tx.get(col(ctx.companyId, C.contracts).where("dealId", "==", id).limit(20));
      linked.docs.forEach((d) => !d.data().archived && statuses.push(String((d.data() as Contract).status)));
      const confirmed = statuses.find((s) => ["approved", "executed", "active"].includes(s));
      const contractStatus = confirmed ?? statuses[0] ?? null;
      const errors = validateDealTransition(
        { kind: deal.kind, customerId: deal.customerId, propertyIds: deal.propertyIds ?? [], contractStatus, lostReason: reason ?? deal.lostReason ?? undefined },
        to,
      );
      if (errors.length) throw new ValidationError(errors);
      const patch: Record<string, unknown> = { status: to };
      if ((to === "lost" || to === "closed") && reason) patch.lostReason = reason;
      txUpdate(tx, ctx, C.deals, deal, input._version === undefined || input._version === null ? null : Number(input._version), patch);
      audit(tx, ctx, "deal.status", C.deals, id, { from: deal.status, to, from_label: labelOf(statusesOf(deal.kind), deal.status), to_label: labelOf(statusesOf(deal.kind), to), reason });
    });
    return null;
  });
}

export async function archiveDeal(input: Record<string, unknown>): Promise<ActionResult<{ redirect: string }>> {
  return run(async () => {
    const ctx = await requireStaff("deal.write");
    const id = str(input.id);
    await adminDb().runTransaction(async (tx) => {
      const cur = await txGet<Deal>(tx, ctx, C.deals, id);
      if (!canAccessStore(ctx, cur.storeId)) throw new ValidationError(["この店舗の案件を編集する権限がありません"]);
      txUpdate(tx, ctx, C.deals, cur, null, { archived: !cur.archived });
      audit(tx, ctx, cur.archived ? "unarchive" : "archive", C.deals, id);
    });
    return { redirect: `/deals/${id}` };
  });
}

// ───────────── 対応記録（外部で行った電話・来店・メール等の手動記録。送信は行わない） ─────────────

const CHANNELS: Activity["channel"][] = ["phone", "visit", "email", "line", "letter", "viewing", "internal", "portal", "other"];

export async function addActivity(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff();
    const entity = str(input.entity) as Activity["entity"];
    const entityId = str(input.entityId);
    const fe: Record<string, string> = {};
    if (entity !== "deal" && entity !== "party") throw new ValidationError(["対象が正しくありません"]);
    if (!ctx.caps.has(entity === "deal" ? "deal.write" : "party.write")) throw new ValidationError(["記録する権限がありません"]);
    const channel = str(input.channel) as Activity["channel"];
    if (!CHANNELS.includes(channel)) fe.channel = "手段を選択してください";
    const direction = (["in", "out", "none"].includes(str(input.direction)) ? str(input.direction) : "none") as Activity["direction"];
    const summary = str(input.summary);
    if (!summary) fe.summary = "要件を入力してください";
    const atLocal = optStr(input.at);
    const at = atLocal ? jstLocalToIso(atLocal) : new Date().toISOString();
    if (!at) fe.at = "日時が正しくありません";
    if (Object.keys(fe).length) throw new ValidationError(Object.values(fe), fe);
    await runOnce(ctx, str(input._requestId), async (tx) => {
      const target = await txGet<BaseDoc & { storeId?: string | null }>(tx, ctx, entity === "deal" ? C.deals : C.parties, entityId);
      if (!canAccessStore(ctx, target.storeId)) throw new ValidationError(["この店舗のデータを編集する権限がありません"]);
      const rec = { entity, entityId, channel, direction, at: at!, summary, body: optStr(input.body), byUid: ctx.uid };
      const id = txCreate(tx, ctx, C.activities, rec);
      audit(tx, ctx, "activity.add", C.activities, id, { entity, entityId, channel, summary });
      return id;
    });
    return null;
  });
}

export async function archiveActivity(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff();
    await adminDb().runTransaction(async (tx) => {
      const a = await txGet<Activity>(tx, ctx, C.activities, str(input.id));
      if (!ctx.caps.has(a.entity === "deal" ? "deal.write" : "party.write")) throw new ValidationError(["権限がありません"]);
      if (a.byUid !== ctx.uid && !ctx.caps.has("assignee.change")) throw new ValidationError(["他の担当者の記録は取り消せません"]);
      txUpdate(tx, ctx, C.activities, a, null, { archived: true });
      audit(tx, ctx, "activity.archive", C.activities, a.id, { summary: a.summary });
    });
    return null;
  });
}

// ───────────── 契約準備: 必要書類をタスクとして作成 ─────────────

export async function createDealDocTasks(input: Record<string, unknown>): Promise<ActionResult<{ created: number }>> {
  return run(async () => {
    const ctx = await requireStaff("deal.write");
    const dealId = str(input.id);
    const created = await runOnce(ctx, str(input._requestId), async (tx) => {
      const deal = await txGet<Deal>(tx, ctx, C.deals, dealId);
      if (!canAccessStore(ctx, deal.storeId)) throw new ValidationError(["この店舗の案件を編集する権限がありません"]);
      const docs = REQUIRED_DOCS[deal.kind];
      const ids = docs.map((_, i) => `dealdoc_${dealId}_${deal.kind}_${i}`);
      const snaps = await Promise.all(ids.map((tid) => tx.get(ref(ctx, C.tasks, tid))));
      const due = deal.nextActionDate && deal.nextActionDate >= todayJst() ? deal.nextActionDate : addDays(todayJst(), 7);
      let n = 0;
      docs.forEach((name, i) => {
        if (snaps[i].exists) return;
        txCreate(tx, ctx, C.tasks, {
          title: `【必要書類】${name}`,
          due,
          assigneeUid: deal.assigneeUid,
          entity: "deal",
          entityId: dealId,
          done: false,
          doneBy: null,
          doneAt: null,
          storeId: deal.storeId,
          sourceKey: ids[i],
        } satisfies Omit<TaskDoc, keyof BaseDoc>, ids[i]);
        n++;
      });
      audit(tx, ctx, "deal.doc_tasks", C.deals, dealId, { created: n });
      return n;
    });
    return { created };
  });
}
