"use server";
import { adminDb } from "../firebase-admin";
import { requireStaff, canAccessStore } from "../session";
import { run, str, optStr, optYen, ActionResult } from "../action";
import { ValidationError, txGet, txCreate, txUpdate, audit, keywords, txNextNumber, runOnce, mustGet } from "../repo";
import { C, Property, Unit, Listing, AreaValue, PropertyKind, Usage, OccupancyStatus, ListingStatus, Attachment } from "@/lib/types";
import { isValidBizDate, todayJst } from "@/lib/domain/dates";

const KINDS: PropertyKind[] = ["land", "building", "condo_unit", "house", "parking_lot"];

function parseAreas(raw: unknown, fe: Record<string, string>, field = "areas"): AreaValue[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(String(raw)) as AreaValue[];
    return arr
      .filter((a) => str(a.value) !== "")
      .map((a, i) => {
        if (!/^\d+(\.\d+)?$/.test(str(a.value))) fe[field] = `面積${i + 1}行目の数値が正しくありません`;
        return {
          kind: a.kind,
          basis: a.basis,
          value: str(a.value),
          unit: a.unit === "tsubo" ? "tsubo" : "m2",
          sourceAttachmentId: a.sourceAttachmentId ?? null,
          note: optStr(a.note),
        };
      });
  } catch {
    fe[field] = "面積の入力内容を読み取れません";
    return [];
  }
}

function parseAccess(raw: unknown): Property["access"] {
  if (!raw) return [];
  try {
    return (JSON.parse(String(raw)) as Property["access"])
      .filter((a) => str(a.line) || str(a.station))
      .map((a) => ({ line: str(a.line), station: str(a.station), walkMin: a.walkMin === null || str(a.walkMin) === "" ? null : Number(a.walkMin) }));
  } catch {
    return [];
  }
}

function propertyFields(v: Record<string, unknown>) {
  const fe: Record<string, string> = {};
  const name = str(v.name);
  if (!name) fe.name = "物件名を入力してください";
  const kind = str(v.kind) as PropertyKind;
  if (!KINDS.includes(kind)) fe.kind = "物件種別を選択してください";
  const built = optStr(v.builtYearMonth);
  if (built && !/^\d{4}-(0[1-9]|1[0-2])$/.test(built)) fe.builtYearMonth = "築年月は YYYY-MM 形式で入力してください";
  const intOrNull = (x: unknown, f: string) => {
    const s = str(x);
    if (!s) return null;
    const n = Number(s);
    if (!Number.isInteger(n) || n < 0) {
      fe[f] = "0以上の整数で入力してください";
      return null;
    }
    return n;
  };
  const data = {
    name,
    kind,
    storeId: optStr(v.storeId),
    assigneeUid: optStr(v.assigneeUid),
    postalCode: optStr(v.postalCode),
    address: optStr(v.address),
    lotNumber: optStr(v.lotNumber),
    structure: optStr(v.structure),
    builtYearMonth: built,
    floorsAbove: intOrNull(v.floorsAbove, "floorsAbove"),
    floorsBelow: intOrNull(v.floorsBelow, "floorsBelow"),
    areas: parseAreas(v.areas, fe),
    access: parseAccess(v.access),
    rights: optStr(v.rights),
    memo: optStr(v.memo),
  };
  return { data, fe };
}

export async function createProperty(v: Record<string, unknown>): Promise<ActionResult<{ redirect: string }>> {
  return run(async () => {
    const ctx = await requireStaff("property.write");
    const { data, fe } = propertyFields(v);
    if (Object.keys(fe).length) throw new ValidationError(Object.values(fe), fe);
    if (!canAccessStore(ctx, data.storeId)) throw new ValidationError(["この店舗に登録する権限がありません"], { storeId: "権限のない店舗です" });
    const id = await runOnce(ctx, str(v._requestId), async (tx) => {
      const number = await txNextNumber(tx, ctx, "property", "P");
      const id = txCreate(tx, ctx, C.properties, {
        ...data,
        number,
        landIds: [],
        dealTypes: [],
        listingStatus: null,
        priceLabel: null,
        keywords: keywords(number, data.name, data.address, data.lotNumber),
      } satisfies Omit<Property, keyof import("../repo").BaseDoc>);
      audit(tx, ctx, "create", C.properties, id, { number, name: data.name });
      return id;
    });
    return { redirect: `/properties/${id}` };
  });
}

export async function updateProperty(id: string, v: Record<string, unknown>): Promise<ActionResult<{ redirect: string }>> {
  return run(async () => {
    const ctx = await requireStaff("property.write");
    const { data, fe } = propertyFields(v);
    if (Object.keys(fe).length) throw new ValidationError(Object.values(fe), fe);
    await adminDb().runTransaction(async (tx) => {
      const cur = await txGet<Property>(tx, ctx, C.properties, id);
      if (!canAccessStore(ctx, cur.storeId) || !canAccessStore(ctx, data.storeId)) throw new ValidationError(["この店舗の物件を編集する権限がありません"]);
      if (cur.assigneeUid !== data.assigneeUid && !ctx.caps.has("assignee.change") && cur.assigneeUid && cur.assigneeUid !== ctx.uid) {
        throw new ValidationError(["担当者を変更する権限がありません"], { assigneeUid: "担当変更は店舗責任者以上が行えます" });
      }
      txUpdate(tx, ctx, C.properties, cur, v._version === null || v._version === undefined ? null : Number(v._version), {
        ...data,
        keywords: keywords(cur.number, data.name, data.address, data.lotNumber),
      });
      audit(tx, ctx, "update", C.properties, id, data);
    });
    return { redirect: `/properties/${id}` };
  });
}

/** 取引履歴のある物件は削除せずアーカイブ */
export async function archiveProperty(input: Record<string, unknown>): Promise<ActionResult<{ redirect: string }>> {
  return run(async () => {
    const ctx = await requireStaff("property.write");
    const id = str(input.id);
    await adminDb().runTransaction(async (tx) => {
      const cur = await txGet<Property>(tx, ctx, C.properties, id);
      txUpdate(tx, ctx, C.properties, cur, null, { archived: !cur.archived });
      audit(tx, ctx, cur.archived ? "unarchive" : "archive", C.properties, id);
    });
    return { redirect: `/properties/${id}` };
  });
}

/** 複製: 基本情報のみ（番号は新規採番、区画・募集条件・写真は複製しない） */
export async function duplicateProperty(input: Record<string, unknown>): Promise<ActionResult<{ redirect: string }>> {
  return run(async () => {
    const ctx = await requireStaff("property.write");
    const src = await mustGet<Property>(ctx, C.properties, str(input.id));
    const id = await runOnce(ctx, str(input._requestId), async (tx) => {
      const number = await txNextNumber(tx, ctx, "property", "P");
      const name = `${src.name}（複製）`;
      const id = txCreate(tx, ctx, C.properties, {
        name, kind: src.kind, storeId: src.storeId, assigneeUid: src.assigneeUid, postalCode: src.postalCode, address: src.address,
        lotNumber: src.lotNumber, structure: src.structure, builtYearMonth: src.builtYearMonth, floorsAbove: src.floorsAbove,
        floorsBelow: src.floorsBelow, areas: src.areas, access: src.access, rights: src.rights, memo: src.memo,
        number, landIds: [], dealTypes: [], listingStatus: null, priceLabel: null, keywords: keywords(number, name, src.address),
      });
      audit(tx, ctx, "duplicate", C.properties, id, { from: src.id });
      return id;
    });
    return { redirect: `/properties/${id}/edit` };
  });
}

// ───────────── 区画（S04） ─────────────

const OCC: OccupancyStatus[] = ["vacant", "occupied", "notice_given", "unavailable"];
const LST: ListingStatus[] = ["preparing", "open", "applied", "closed", "suspended"];
const USAGE: Usage[] = ["residential", "store", "office", "parking", "other"];

function unitFields(v: Record<string, unknown>) {
  const fe: Record<string, string> = {};
  const number = str(v.number);
  if (!number) fe.number = "部屋番号・区画番号を入力してください";
  const usage = str(v.usage) as Usage;
  if (!USAGE.includes(usage)) fe.usage = "用途を選択してください";
  const occupancy = str(v.occupancy) as OccupancyStatus;
  if (!OCC.includes(occupancy)) fe.occupancy = "入居状態を選択してください";
  const ls = optStr(v.listingStatus) as ListingStatus | null;
  if (ls && !LST.includes(ls)) fe.listingStatus = "募集状態が正しくありません";
  for (const f of ["expectedVacancyDate", "availableFrom"]) {
    const d = optStr(v[f]);
    if (d && !isValidBizDate(d)) fe[f] = "日付が正しくありません";
  }
  const floor = str(v.floor) === "" ? null : Number(v.floor);
  if (floor !== null && !Number.isInteger(floor)) fe.floor = "階は整数で入力してください";
  // B02: 退去予定の部屋は募集可能。入居中で退去予定なしの部屋を「募集中」にはできない
  if (occupancy === "occupied" && ls === "open" && !optStr(v.expectedVacancyDate)) {
    fe.listingStatus = "入居中の部屋を募集するには退去予定日を入力するか、入居状態を「退去予定」にしてください";
  }
  return {
    fe,
    data: {
      number,
      usage,
      layout: optStr(v.layout),
      areas: parseAreas(v.areas, fe),
      floor,
      equipment: str(v.equipment).split(/[,、\n]/).map((s) => s.trim()).filter(Boolean),
      occupancy,
      listingStatus: ls,
      expectedVacancyDate: optStr(v.expectedVacancyDate),
      availableFrom: optStr(v.availableFrom),
    },
  };
}

export async function saveUnit(propertyId: string, unitId: string | null, v: Record<string, unknown>): Promise<ActionResult<{ redirect: string }>> {
  return run(async () => {
    const ctx = await requireStaff("property.write");
    const { data, fe } = unitFields(v);
    if (Object.keys(fe).length) throw new ValidationError(Object.values(fe), fe);
    await adminDb().runTransaction(async (tx) => {
      const prop = await txGet<Property>(tx, ctx, C.properties, propertyId);
      if (!canAccessStore(ctx, prop.storeId)) throw new ValidationError(["この店舗の物件を編集する権限がありません"]);
      const kw = keywords(prop.number, prop.name, data.number, prop.address);
      if (unitId) {
        const cur = await txGet<Unit>(tx, ctx, C.units, unitId);
        if (cur.propertyId !== propertyId) throw new ValidationError(["区画が物件に属していません"]);
        txUpdate(tx, ctx, C.units, cur, v._version === undefined || v._version === null ? null : Number(v._version), { ...data, keywords: kw, storeId: prop.storeId });
        audit(tx, ctx, "update", C.units, unitId, data);
      } else {
        const id = txCreate(tx, ctx, C.units, { ...data, propertyId, currentContractId: null, storeId: prop.storeId, keywords: kw });
        audit(tx, ctx, "create", C.units, id, data);
      }
    });
    return { redirect: `/properties/${propertyId}?tab=units` };
  });
}

// ───────────── 募集条件（版管理） ─────────────

/** 物件と募集条件を別保存し、過去の条件を残す。新しい版を作成し前の版は supersededBy を設定 */
export async function saveListing(propertyId: string, v: Record<string, unknown>): Promise<ActionResult<{ redirect: string }>> {
  return run(async () => {
    const ctx = await requireStaff("property.write");
    const fe: Record<string, string> = {};
    const dealType = str(v.dealType) as "rent" | "sale";
    if (!["rent", "sale"].includes(dealType)) fe.dealType = "賃貸・売買を選択してください";
    const status = str(v.status) as ListingStatus;
    if (!LST.includes(status)) fe.status = "募集状態を選択してください";
    const effectiveFrom = str(v.effectiveFrom) || todayJst();
    if (!isValidBizDate(effectiveFrom)) fe.effectiveFrom = "適用開始日が正しくありません";
    const availableFrom = optStr(v.availableFrom);
    if (availableFrom && !isValidBizDate(availableFrom)) fe.availableFrom = "日付が正しくありません";
    const rent = optYen(v.rent, "rent", fe);
    const commonFee = optYen(v.commonFee, "commonFee", fe);
    const deposit = optYen(v.deposit, "deposit", fe);
    const keyMoney = optYen(v.keyMoney, "keyMoney", fe);
    const price = optYen(v.price, "price", fe);
    if (dealType === "rent" && status === "open" && rent === null) fe.rent = "募集中にするには賃料を入力してください";
    if (dealType === "sale" && status === "open" && price === null) fe.price = "募集中にするには価格を入力してください";
    const unitId = optStr(v.unitId);
    if (Object.keys(fe).length) throw new ValidationError(Object.values(fe), fe);
    const tm = optStr(v.transactionMode) as Listing["transactionMode"];

    await runOnce(ctx, str(v._requestId), async (tx) => {
      const prop = await txGet<Property>(tx, ctx, C.properties, propertyId);
      const unit = unitId ? await txGet<Unit>(tx, ctx, C.units, unitId) : null;
      if (unit && unit.propertyId !== propertyId) throw new ValidationError(["区画が物件に属していません"]);
      const prevId = optStr(v.previousId);
      let prev: Listing | null = null;
      if (prevId) prev = await txGet<Listing>(tx, ctx, C.listings, prevId);
      if (prev && prev.supersededBy) throw new ValidationError(["この募集条件は既に更新されています。画面を読み直してください"]);
      const id = txCreate(tx, ctx, C.listings, {
        propertyId, unitId, dealType, status, effectiveFrom, supersededBy: null, rent, commonFee, deposit, keyMoney, price, availableFrom,
        transactionMode: tm, comment: optStr(v.comment),
      });
      if (prev) txUpdate(tx, ctx, C.listings, prev, null, { supersededBy: id });
      if (unit) txUpdate(tx, ctx, C.units, unit, null, { listingStatus: status, availableFrom });
      const priceLabel = dealType === "rent" ? (rent !== null ? `賃料 ${rent.toLocaleString()}円` : null) : price !== null ? `価格 ${price.toLocaleString()}円` : null;
      txUpdate(tx, ctx, C.properties, prop, null, {
        dealTypes: [...new Set([...(prop.dealTypes ?? []), dealType])],
        listingStatus: status,
        priceLabel,
      });
      audit(tx, ctx, "listing.version", C.listings, id, { previous: prevId, status, rent, price });
      return id;
    });
    return { redirect: `/properties/${propertyId}?tab=listing` };
  });
}

// ───────────── 写真・資料（S05） ─────────────

/** 表示順・分類・説明・公開範囲の一括更新。原本ファイルは加工しない */
export async function updateAttachments(input: {
  entity: string;
  entityId: string;
  items: { id: string; sort: number; category: string; description: string | null; visibility: Attachment["visibility"]; takenAt: string | null }[];
}): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff();
    const { ENTITY_WRITE_CAP } = await import("../attachments");
    const cap = ENTITY_WRITE_CAP[input.entity];
    if (!cap || !ctx.caps.has(cap)) throw new ValidationError(["編集する権限がありません"]);
    await adminDb().runTransaction(async (tx) => {
      const docs = await Promise.all(input.items.map((it) => txGet<Attachment>(tx, ctx, C.attachments, it.id)));
      docs.forEach((d, i) => {
        if (!d.linkKeys.includes(`${input.entity}:${input.entityId}`)) throw new ValidationError(["対象外のファイルが含まれています"]);
        const it = input.items[i];
        if (it.takenAt && !isValidBizDate(it.takenAt)) throw new ValidationError(["撮影日が正しくありません"]);
        txUpdate(tx, ctx, C.attachments, d, null, {
          sort: it.sort,
          category: str(it.category) || "その他",
          description: optStr(it.description),
          visibility: d.sensitive ? "internal" : it.visibility,
          takenAt: it.takenAt || null,
        });
      });
      audit(tx, ctx, "attachments.bulk_update", C.attachments, input.entityId, { count: input.items.length });
    });
    return null;
  });
}

export async function archiveAttachment(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff();
    const { ENTITY_WRITE_CAP } = await import("../attachments");
    await adminDb().runTransaction(async (tx) => {
      const a = await txGet<Attachment>(tx, ctx, C.attachments, str(input.id));
      if (!a.links.some((l) => ctx.caps.has(ENTITY_WRITE_CAP[l.entity]))) throw new ValidationError(["権限がありません"]);
      txUpdate(tx, ctx, C.attachments, a, null, { archived: true });
      audit(tx, ctx, "archive", C.attachments, a.id, { fileName: a.fileName });
    });
    return null;
  });
}
