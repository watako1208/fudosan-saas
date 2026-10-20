"use server";
import { adminDb } from "../firebase-admin";
import { requireStaff, canAccessStore, Ctx } from "../session";
import { run, str, optStr, ActionResult } from "../action";
import { ValidationError, txGet, txCreate, txUpdate, audit, runOnce, listDocs, getMany, findDocs, nowIso, BaseDoc } from "../repo";
import { C, Deal, Property, Unit, Listing, AreaValue } from "@/lib/types";
import type { Proposal, ProposalItem } from "@/lib/types-deals";

// S10 物件提案。登録済みの物件・区画から作成し、作成時点の募集条件をスナップショットとして保存する。
// 顧客への公開は自社の外部利用者ページ（顧客ページ）での閲覧のみ（外部ポータル・メール送信は行わない）。

const AREA_BASIS: Record<string, string> = { registry: "登記", survey: "実測", wall_center: "壁芯", inner: "内法", other: "その他" };

function areaLabel(areas: AreaValue[] | undefined): string | null {
  if (!areas?.length) return null;
  const a = areas.find((x) => x.kind === "exclusive") ?? areas.find((x) => x.kind === "floor_total") ?? areas[0];
  return `${a.value}${a.unit === "m2" ? "㎡" : "坪"}（${AREA_BASIS[a.basis] ?? a.basis}）`;
}

async function listingsFor(ctx: Ctx, propertyIds: string[]): Promise<Listing[]> {
  const ids = [...new Set(propertyIds)];
  const out: Listing[] = [];
  for (let i = 0; i < ids.length; i += 30) out.push(...(await findDocs<Listing>(ctx, C.listings, [["propertyId", "in", ids.slice(i, i + 30)]])));
  return out.filter((l) => !l.archived && !l.supersededBy);
}

function pickListing(listings: Listing[], propertyId: string, unitId: string | null): Listing | null {
  const cands = listings.filter((l) => l.propertyId === propertyId && (l.unitId ?? null) === unitId);
  const fallback = unitId ? listings.filter((l) => l.propertyId === propertyId && !l.unitId) : [];
  const pool = cands.length ? cands : fallback;
  const rank = (l: Listing) => (l.status === "open" ? 0 : l.status === "preparing" ? 1 : l.status === "applied" ? 2 : 3);
  return [...pool].sort((a, b) => rank(a) - rank(b) || (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0] ?? null;
}

async function snapshots(ctx: Ctx, targets: { propertyId: string; unitId: string | null }[]): Promise<Map<string, Omit<ProposalItem, "comment">>> {
  const props = await getMany<Property>(ctx, C.properties, targets.map((t) => t.propertyId));
  const units = await getMany<Unit>(ctx, C.units, targets.map((t) => t.unitId ?? "").filter(Boolean));
  const listings = await listingsFor(ctx, targets.map((t) => t.propertyId));
  const out = new Map<string, Omit<ProposalItem, "comment">>();
  for (const t of targets) {
    const p = props.get(t.propertyId);
    if (!p) throw new ValidationError(["提案物件が見つかりません。選び直してください"]);
    const u = t.unitId ? units.get(t.unitId) : null;
    if (t.unitId && (!u || u.propertyId !== p.id)) throw new ValidationError(["部屋・区画が物件に属していません"]);
    const l = pickListing(listings, p.id, t.unitId);
    out.set(`${t.propertyId}:${t.unitId ?? ""}`, {
      propertyId: p.id,
      unitId: t.unitId,
      listingId: l?.id ?? null,
      snapshotAt: nowIso(),
      propertyNumber: p.number,
      propertyName: p.name,
      unitNumber: u?.number ?? null,
      address: p.address,
      layout: u?.layout ?? null,
      dealType: l?.dealType ?? null,
      rent: l?.rent ?? null,
      commonFee: l?.commonFee ?? null,
      deposit: l?.deposit ?? null,
      keyMoney: l?.keyMoney ?? null,
      price: l?.price ?? null,
      area: areaLabel(u?.areas?.length ? u.areas : p.areas),
      availableFrom: l?.availableFrom ?? u?.availableFrom ?? null,
    });
  }
  return out;
}

/** 提案・案件用の物件／区画検索（現在の募集条件の要約つき） */
export async function searchListingCandidates(input: { q: string }): Promise<ActionResult<{ propertyId: string; unitId: string | null; label: string; sub: string }[]>> {
  return run(async () => {
    const ctx = await requireStaff("property.read");
    const q = str(input.q);
    if (!q) return [];
    const [props, units] = await Promise.all([
      listDocs<Property>(ctx, C.properties, { search: q, pageSize: 25 }),
      listDocs<Unit>(ctx, C.units, { search: q, pageSize: 50 }),
    ]);
    const propMap = await getMany<Property>(ctx, C.properties, [...props.items.map((p) => p.id), ...units.items.map((u) => u.propertyId)]);
    const listings = await listingsFor(ctx, [...propMap.keys()]);
    const yenS = (n: number | null) => (n === null ? null : `${n.toLocaleString("ja-JP")}円`);
    const summary = (pid: string, uid: string | null) => {
      const l = pickListing(listings, pid, uid);
      if (!l) return "募集条件なし";
      return l.dealType === "rent" ? `賃料 ${yenS(l.rent) ?? "未入力"}` : `価格 ${yenS(l.price) ?? "未入力"}`;
    };
    const out: { propertyId: string; unitId: string | null; label: string; sub: string }[] = [];
    for (const p of props.items) out.push({ propertyId: p.id, unitId: null, label: `${p.name}（物件全体）`, sub: `${p.number} / ${p.address ?? "所在地未入力"} / ${summary(p.id, null)}` });
    for (const u of units.items) {
      const p = propMap.get(u.propertyId);
      if (!p) continue;
      out.push({ propertyId: p.id, unitId: u.id, label: `${p.name} ${u.number}`, sub: `${p.number} / ${u.layout ?? "間取り未入力"} / ${summary(p.id, u.id)}` });
    }
    return out.slice(0, 60);
  });
}

export async function createProposal(input: Record<string, unknown>): Promise<ActionResult<{ redirect: string }>> {
  return run(async () => {
    const ctx = await requireStaff("deal.write");
    const dealId = str(input.dealId);
    const deal0 = (await getMany<Deal>(ctx, C.deals, [dealId])).get(dealId);
    if (!deal0) throw new ValidationError(["案件が見つかりません"]);
    // 案件の対象物件を初期の候補にする
    const targets = deal0.unitIds?.length
      ? (await getMany<Unit>(ctx, C.units, deal0.unitIds)).values()
      : null;
    const initial: { propertyId: string; unitId: string | null }[] = targets ? [...targets].map((u) => ({ propertyId: u.propertyId, unitId: u.id })) : [];
    for (const pid of deal0.propertyIds ?? []) if (!initial.some((t) => t.propertyId === pid)) initial.push({ propertyId: pid, unitId: null });
    const snaps = await snapshots(ctx, initial);
    const id = await runOnce(ctx, str(input._requestId), async (tx) => {
      const deal = await txGet<Deal>(tx, ctx, C.deals, dealId);
      if (!canAccessStore(ctx, deal.storeId)) throw new ValidationError(["この店舗の案件を編集する権限がありません"]);
      const nid = txCreate(tx, ctx, C.proposals, {
        dealId,
        customerId: deal.customerId,
        storeId: deal.storeId,
        title: `${deal.title} 物件のご提案`,
        comment: null,
        items: [...snaps.values()].map((s) => ({ ...s, comment: null })),
        publishedToCustomer: false,
        publishedAt: null,
        publishedBy: null,
        reactions: [],
      } satisfies Omit<Proposal, keyof BaseDoc>);
      audit(tx, ctx, "create", C.proposals, nid, { dealId });
      return nid;
    });
    return { redirect: `/deals/${dealId}/proposals/${id}` };
  });
}

/**
 * 提案内容の保存。既存の候補は保存済みのスナップショットを維持し（募集条件を後で変えても提案内容は変わらない）、
 * 追加した候補と「最新の条件で更新」を指定した候補だけ現在の募集条件を取り込む。
 */
export async function saveProposal(id: string, v: Record<string, unknown>): Promise<ActionResult<{ redirect: string }>> {
  return run(async () => {
    const ctx = await requireStaff("deal.write");
    const title = str(v.title);
    if (!title) throw new ValidationError(["提案名を入力してください"], { title: "提案名を入力してください" });
    let rows: { propertyId: string; unitId: string | null; comment: string | null; refresh?: boolean }[] = [];
    try {
      rows = (JSON.parse(str(v.items) || "[]") as typeof rows).map((r) => ({ propertyId: str(r.propertyId), unitId: r.unitId || null, comment: optStr(r.comment), refresh: !!r.refresh }));
    } catch {
      throw new ValidationError(["提案物件の入力内容を読み取れません"]);
    }
    if (rows.length > 50) throw new ValidationError(["提案物件は50件までです"]);
    const keys = rows.map((r) => `${r.propertyId}:${r.unitId ?? ""}`);
    if (new Set(keys).size !== keys.length) throw new ValidationError(["同じ物件・部屋が重複しています"]);
    const cur0 = (await getMany<Proposal>(ctx, C.proposals, [id])).get(id);
    if (!cur0) throw new ValidationError(["提案が見つかりません"]);
    const existing = new Map(cur0.items.map((it) => [`${it.propertyId}:${it.unitId ?? ""}`, it]));
    const need = rows.filter((r) => r.refresh || !existing.has(`${r.propertyId}:${r.unitId ?? ""}`));
    const snaps = await snapshots(ctx, need);
    await adminDb().runTransaction(async (tx) => {
      const cur = await txGet<Proposal>(tx, ctx, C.proposals, id);
      const deal = await txGet<Deal>(tx, ctx, C.deals, cur.dealId);
      if (!canAccessStore(ctx, deal.storeId)) throw new ValidationError(["この店舗の案件を編集する権限がありません"]);
      const prevKeys = cur.items.map((it) => `${it.propertyId}:${it.unitId ?? ""}`);
      const items: ProposalItem[] = rows.map((r) => {
        const k = `${r.propertyId}:${r.unitId ?? ""}`;
        const base = snaps.get(k) ?? existing.get(k)!;
        return { ...base, comment: r.comment };
      });
      // 顧客の反応は候補の位置で紐づくため、並び替え・削除時は新しい位置へ付け替える（削除された候補の反応は残さない）
      const reactions = (cur.reactions ?? [])
        .map((x) => ({ ...x, itemIndex: keys.indexOf(prevKeys[x.itemIndex] ?? "") }))
        .filter((x) => x.itemIndex >= 0);
      txUpdate(tx, ctx, C.proposals, cur, v._version === undefined || v._version === null ? null : Number(v._version), {
        title, comment: optStr(v.comment), items, reactions, customerId: deal.customerId,
      });
      audit(tx, ctx, "update", C.proposals, id, { title, items: items.length });
    });
    return { redirect: `/deals/${cur0.dealId}/proposals/${id}` };
  });
}

/** 顧客ページへの公開・非公開 */
export async function publishProposal(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff("deal.write");
    const publish = input.publish === true || input.publish === "true";
    await adminDb().runTransaction(async (tx) => {
      const cur = await txGet<Proposal>(tx, ctx, C.proposals, str(input.id));
      const deal = await txGet<Deal>(tx, ctx, C.deals, cur.dealId);
      if (!canAccessStore(ctx, deal.storeId)) throw new ValidationError(["この店舗の案件を編集する権限がありません"]);
      if (publish && !deal.customerId) throw new ValidationError(["案件に顧客が設定されていないため公開できません"]);
      if (publish && cur.items.length === 0) throw new ValidationError(["提案物件がありません"]);
      txUpdate(tx, ctx, C.proposals, cur, null, publish
        ? { publishedToCustomer: true, publishedAt: nowIso(), publishedBy: ctx.uid, customerId: deal.customerId }
        : { publishedToCustomer: false });
      audit(tx, ctx, publish ? "proposal.publish" : "proposal.unpublish", C.proposals, cur.id, { customerId: deal.customerId });
    });
    return null;
  });
}

export async function archiveProposal(input: Record<string, unknown>): Promise<ActionResult<{ redirect: string }>> {
  return run(async () => {
    const ctx = await requireStaff("deal.write");
    let dealId = "";
    await adminDb().runTransaction(async (tx) => {
      const cur = await txGet<Proposal>(tx, ctx, C.proposals, str(input.id));
      const deal = await txGet<Deal>(tx, ctx, C.deals, cur.dealId);
      if (!canAccessStore(ctx, deal.storeId)) throw new ValidationError(["この店舗の案件を編集する権限がありません"]);
      dealId = deal.id;
      txUpdate(tx, ctx, C.proposals, cur, null, { archived: true, publishedToCustomer: false });
      audit(tx, ctx, "archive", C.proposals, cur.id);
    });
    return { redirect: `/deals/${dealId}?tab=proposals` };
  });
}
