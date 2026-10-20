import "server-only";
// 差込みデータの作成: 対象（契約・請求・精算・修繕・退去・更新・案件・物件）の現在値を Firestore から取得する。
// 契約当事者は契約版の当事者スナップショットを使う（顧客台帳の後日の変更を反映しない）。
// 値がない項目は null のまま返し、表示時に「未入力」として未確認項目に挙げる。

import { getDoc, findDocs, getMany, NotFoundError, nowIso } from "../repo";
import { Ctx, AuthError, canAccessStore } from "../session";
import { ENTITY_READ_CAP } from "../attachments";
import { staffName, companyName } from "../lookups";
import {
  C, Contract, ContractVersion, ContractPartySnapshot, Invoice, Allocation, Payment, Settlement, Repair, Estimate, Moveout, Renewal,
  Property, Unit, Party, Deal, Listing, AreaValue, EventDoc, ApplicationDoc, DepositEntryDoc, BaseDoc,
} from "@/lib/types";
import type { TaxSetting } from "@/lib/domain/money";
import { depositBalance, CONTRACT_STATUSES, REPAIR_STATUSES, labelOf } from "@/lib/domain/rules";
import { todayJst } from "@/lib/domain/dates";
import { DOC_TYPES, DocEntity, DOC_ENTITY_KEYS } from "@/lib/labels-documents";
import { MergeData, FieldValue, ListRow, fmtYen, fmtDate, fmtYm, fmtDateTime, fmtNum, s, receiptAmount } from "./engine";

export interface BuildResult {
  data: MergeData;
  title: string;
  storeId: string | null;
  /** 作成を止める理由（領収書の入金なし等） */
  errors: string[];
}

const ROLE_JA: Record<string, string> = {
  lessor: "貸主", lessee: "借主", seller: "売主", buyer: "買主", guarantor: "連帯保証人", occupant: "同居人", agent: "代理人",
};
const BURDEN_JA: Record<string, string> = { lessor: "貸主", lessee: "借主", company: "自社", other: "その他" };
const OCC_JA: Record<string, string> = { vacant: "空室", occupied: "入居中", notice_given: "退去予定", unavailable: "利用不可" };
const AREA_BASIS_JA: Record<string, string> = { registry: "登記", survey: "実測", wall_center: "壁芯", inner: "内法", other: "" };

export function taxLabel(t: TaxSetting | null | undefined): FieldValue {
  if (!t) return null;
  if (t.category === "exempt") return "非課税";
  if (t.category === "non_taxable") return "不課税";
  const pct = Math.round(Number(t.rate) * 1000) / 10;
  return `課税${pct}%（${t.priceMode === "inclusive" ? "税込" : "税抜"}）`;
}

function areaLabel(areas: AreaValue[] | undefined, prefer: AreaValue["kind"][]): FieldValue {
  if (!areas?.length) return null;
  const a = prefer.map((k) => areas.find((x) => x.kind === k)).find(Boolean) ?? areas[0];
  if (!a?.value) return null;
  const basis = AREA_BASIS_JA[a.basis] ? `（${AREA_BASIS_JA[a.basis]}）` : "";
  return `${a.value}${a.unit === "tsubo" ? "坪" : "㎡"}${basis}`;
}

function maxStamp(...docs: (BaseDoc | null | undefined)[]): string | null {
  const ts = docs.filter((d): d is BaseDoc => !!d).map((d) => d.updatedAt).filter(Boolean);
  return ts.length ? ts.sort().at(-1)! : null;
}

class Acc {
  fields: Record<string, FieldValue> = {};
  lists: Record<string, ListRow[] | null> = {};
  parties = new Set<string>();
  attach: { entity: string; id: string }[] = [];
  put(path: string, v: FieldValue) {
    this.fields[path] = v;
  }
  list(path: string, rows: ListRow[] | null) {
    this.lists[path] = rows;
  }
  party(id: string | null | undefined) {
    if (id) this.parties.add(id);
  }
  att(entity: string, id: string | null | undefined) {
    if (id && !this.attach.some((a) => a.entity === entity && a.id === id)) this.attach.push({ entity, id });
  }
}

function putParty(a: Acc, prefix: string, p: { name?: string | null; address?: string | null; phone?: string | null } | null | undefined) {
  a.put(`${prefix}.name`, s(p?.name));
  a.put(`${prefix}.address`, s(p?.address));
  a.put(`${prefix}.phone`, s(p?.phone));
}

function putProperty(a: Acc, p: Property | null) {
  a.put("property.number", s(p?.number));
  a.put("property.name", s(p?.name));
  a.put("property.address", s(p?.address));
  a.put("property.structure", s(p?.structure));
  a.put("property.builtYearMonth", p?.builtYearMonth ? fmtYm(p.builtYearMonth) : null);
  a.put("property.floors", p && p.floorsAbove !== null && p.floorsAbove !== undefined ? `地上${p.floorsAbove}階${p.floorsBelow ? `・地下${p.floorsBelow}階` : ""}` : null);
  a.put("property.access", p?.access?.length ? p.access.map((x) => `${x.line} ${x.station}駅${x.walkMin !== null ? ` 徒歩${x.walkMin}分` : ""}`).join(" / ") : null);
  a.put("property.rights", s(p?.rights));
  a.put("property.lotNumber", s(p?.lotNumber));
  if (p) a.att("property", p.id);
}

function putUnit(a: Acc, u: Unit | null, p: Property | null) {
  a.put("unit.number", s(u?.number));
  a.put("unit.layout", s(u?.layout));
  a.put("unit.area", areaLabel(u?.areas, ["exclusive", "floor_total"]));
  a.put("unit.floor", fmtNum(u?.floor ?? null, "階"));
  a.put("unit.address", p?.address ? `${p.address}${p.name ? ` ${p.name}` : ""}${u?.number ? ` ${u.number}号室` : ""}` : null);
  if (u) a.att("unit", u.id);
}

async function currentListing(ctx: Ctx, propertyId: string, unitId: string | null): Promise<Listing | null> {
  const ls = (await findDocs<Listing>(ctx, C.listings, [["propertyId", "==", propertyId]], 200)).filter((l) => !l.supersededBy && !l.archived);
  const pick = (unitId ? ls.filter((l) => l.unitId === unitId) : []).concat(ls.filter((l) => !l.unitId));
  pick.sort((x, y) => (x.effectiveFrom < y.effectiveFrom ? 1 : -1));
  return pick[0] ?? null;
}

function putListing(a: Acc, l: Listing | null) {
  a.put("listing.rent", fmtYen(l?.rent));
  a.put("listing.commonFee", fmtYen(l?.commonFee));
  a.put("listing.deposit", fmtYen(l?.deposit));
  a.put("listing.keyMoney", fmtYen(l?.keyMoney));
  a.put("listing.price", fmtYen(l?.price));
  a.put("listing.availableFrom", fmtDate(l?.availableFrom));
  a.put("listing.comment", s(l?.comment));
}

async function contractVersionOf(ctx: Ctx, c: Contract): Promise<ContractVersion | null> {
  if (c.currentVersionId) {
    const v = await getDoc<ContractVersion>(ctx, C.contractVersions, c.currentVersionId);
    if (v && v.contractId === c.id) return v;
  }
  const vs = await findDocs<ContractVersion>(ctx, C.contractVersions, [["contractId", "==", c.id]], 100);
  vs.sort((x, y) => y.versionNo - x.versionNo);
  return vs[0] ?? null;
}

/** 契約の差込み項目（当事者は契約版のスナップショット） */
async function putContract(ctx: Ctx, a: Acc, c: Contract): Promise<{ version: ContractVersion | null; property: Property | null; unit: Unit | null }> {
  const v = await contractVersionOf(ctx, c);
  a.put("contract.number", s(c.number));
  a.put("contract.title", s(c.title));
  a.put("contract.kind", { lease: "賃貸借", sale: "売買", brokerage: "媒介", management: "管理委託" }[c.kind] ?? null);
  a.put("contract.start", fmtDate(v?.start ?? c.start));
  a.put("contract.end", fmtDate(v?.end ?? c.end));
  a.put("contract.leaseType", v?.leaseType ? (v.leaseType === "fixed_term" ? "定期借家" : "普通借家") : null);
  a.put("contract.versionNo", v ? `第${v.versionNo}版` : null);
  a.put("contract.specialTerms", s(v?.specialTerms));
  a.put("contract.paymentDueDay", v?.paymentDueDay ? `${v.paymentTiming === "prev_month" ? "前月" : "当月"}${v.paymentDueDay}日` : null);
  a.put("contract.status", labelOf(CONTRACT_STATUSES, c.status));
  const parties: ContractPartySnapshot[] = v?.parties ?? [];
  const byRole = (r: ContractPartySnapshot["role"]) => parties.find((p) => p.role === r) ?? null;
  for (const r of ["lessor", "lessee", "seller", "buyer", "guarantor"] as const) putParty(a, r, byRole(r));
  a.list("contract.parties", v ? parties.map((p) => ({ role: ROLE_JA[p.role] ?? p.role, name: s(p.name), address: s(p.address), phone: s(p.phone) })) : null);
  parties.forEach((p) => a.party(p.partyId));
  (c.partyIds ?? []).forEach((id) => a.party(id));
  // 月額・初期費用
  const monthly = v?.monthlyItems ?? null;
  const find = (codes: string[], names: RegExp) => monthly?.find((m) => codes.includes(m.code) || names.test(m.name)) ?? null;
  const rent = find(["rent"], /^賃料|家賃/);
  const cf = find(["common_fee", "commonFee", "management_fee"], /共益費|管理費/);
  a.put("monthly.rent", rent ? fmtYen(rent.amount) : null);
  a.put("monthly.commonFee", cf ? fmtYen(cf.amount) : null);
  a.put("monthly.total", monthly && monthly.length ? fmtYen(monthly.reduce((x, m) => x + (m.amount ?? 0), 0)) : null);
  a.list("contract.monthlyItems", monthly ? monthly.map((m) => ({ name: s(m.name), amount: fmtYen(m.amount), tax: taxLabel(m.tax) })) : null);
  const initial = v?.initialItems ?? null;
  a.list("contract.initialItems", initial ? initial.map((m) => ({ name: s(m.name), amount: fmtYen(m.amount), tax: taxLabel(m.tax) })) : null);
  a.put("initial.total", initial && initial.length ? fmtYen(initial.reduce((x, m) => x + (m.amount ?? 0), 0)) : null);
  a.put("deposit.amount", fmtYen(v?.depositAmount));
  a.put("renewal.termMonths", fmtNum(v?.renewal?.termMonths ?? null, "か月"));
  a.put("renewal.fee", fmtYen(v?.renewal?.fee));
  // 売買
  a.put("sale.price", fmtYen(v?.salePrice));
  a.put("sale.earnestMoney", fmtYen(v?.earnestMoney));
  a.put("sale.balance", fmtYen(v?.balanceAmount));
  a.put("sale.contractDate", fmtDate(v?.contractDate));
  a.put("sale.settlementDate", fmtDate(v?.settlementDate));
  a.put("sale.deliveryDate", fmtDate(v?.deliveryDate));
  a.put("loan.amount", fmtYen(v?.loan?.amount));
  a.put("loan.deadline", fmtDate(v?.loan?.deadline));
  a.put("loan.lender", s(v?.loan?.lender));
  // 物件・区画
  const unit = c.unitId ? await getDoc<Unit>(ctx, C.units, c.unitId) : null;
  const props = await getMany<Property>(ctx, C.properties, [...(unit ? [unit.propertyId] : []), ...(c.propertyIds ?? [])]);
  const property = (unit ? props.get(unit.propertyId) : null) ?? (c.propertyIds?.length ? props.get(c.propertyIds[0]) ?? null : null);
  putProperty(a, property ?? null);
  putUnit(a, unit, property ?? null);
  if (c.kind === "sale" || (c.propertyIds?.length ?? 0) > 0) {
    a.list(
      "contract.properties",
      (c.propertyIds ?? []).map((id) => {
        const p = props.get(id);
        return { number: s(p?.number), name: s(p?.name), address: s(p?.address), lotNumber: s(p?.lotNumber) };
      }),
    );
  }
  a.att("contract", c.id);
  return { version: v, property: property ?? null, unit };
}

function ensureStore(ctx: Ctx, storeId: string | null | undefined) {
  if (!canAccessStore(ctx, storeId)) throw new AuthError("この店舗のデータを閲覧する権限がありません");
}

/** 差込みデータを作成する。docType が対象に合わない場合や権限がない場合は例外 */
export async function buildMergeData(ctx: Ctx, entity: string, entityId: string, docType: string): Promise<BuildResult> {
  if (!DOC_ENTITY_KEYS.includes(entity as DocEntity)) throw new NotFoundError();
  const def = DOC_TYPES[docType];
  if (!def) throw new AuthError("書類種別が正しくありません");
  if (!def.entities.includes(entity as DocEntity)) throw new AuthError(`「${def.label}」はこの対象からは作成できません`);
  const cap = ENTITY_READ_CAP[entity];
  if (!cap || !ctx.caps.has(cap)) throw new AuthError("差込み元のデータを閲覧する権限がありません");

  const a = new Acc();
  const errors: string[] = [];
  let title = "";
  let entityNumber: string | null = null;
  let stamp: string | null = null;
  let storeId: string | null = null;

  switch (entity as DocEntity) {
    case "contract": {
      const c = await getDoc<Contract>(ctx, C.contracts, entityId);
      if (!c) throw new NotFoundError();
      ensureStore(ctx, c.storeId);
      const r = await putContract(ctx, a, c);
      title = c.title || c.number;
      entityNumber = c.number;
      storeId = c.storeId;
      stamp = maxStamp(c, r.version);
      if (docType === "required_docs") a.list("deal.requiredDocs", c.dealId ? await requiredDocs(ctx, c.dealId) : null);
      break;
    }
    case "invoice": {
      const inv = await getDoc<Invoice>(ctx, C.invoices, entityId);
      if (!inv) throw new NotFoundError();
      ensureStore(ctx, inv.storeId);
      const billTo = inv.billToPartyId ? await getDoc<Party>(ctx, C.parties, inv.billToPartyId) : null;
      a.put("invoice.number", s(inv.number));
      a.put("invoice.issueDate", fmtDate(inv.issueDate));
      a.put("invoice.dueDate", fmtDate(inv.dueDate));
      a.put("invoice.period", fmtYm(inv.period));
      a.put("invoice.billToName", s(inv.billToName));
      a.put("invoice.billToAddress", s(billTo?.address));
      a.put("invoice.subtotal", fmtYen(inv.subtotal));
      a.put("invoice.tax", fmtYen(inv.tax));
      a.put("invoice.total", fmtYen(inv.total));
      a.put("invoice.paid", fmtYen(inv.paid));
      a.put("invoice.balance", typeof inv.total === "number" && typeof inv.paid === "number" ? fmtYen(inv.total - inv.paid) : null);
      a.list(
        "invoice.lines",
        (inv.lines ?? []).map((l) => ({
          name: s(l.name),
          period: l.from && l.to ? `${fmtDate(l.from)}〜${fmtDate(l.to)}` : fmtYm(l.period),
          quantity: s(l.quantity),
          unitPrice: l.unitPrice ? fmtYen(Number(l.unitPrice)) : null,
          amount: fmtYen(l.amount),
          tax: taxLabel(l.tax),
        })),
      );
      a.party(inv.billToPartyId);
      const unit = inv.unitId ? await getDoc<Unit>(ctx, C.units, inv.unitId) : null;
      const property = inv.propertyId || unit ? await getDoc<Property>(ctx, C.properties, inv.propertyId ?? unit!.propertyId) : null;
      putProperty(a, property);
      putUnit(a, unit, property);
      if (inv.contractId) a.put("contract.number", s((await getDoc<Contract>(ctx, C.contracts, inv.contractId))?.number));
      title = `${inv.number} ${inv.billToName ?? ""}`.trim();
      entityNumber = inv.number;
      storeId = inv.storeId;
      stamp = maxStamp(inv);
      a.att("invoice", inv.id);
      if (docType === "receipt") {
        // 領収書: 実際の入金配分だけを根拠にする（請求額ではない）
        const allocs = (await findDocs<Allocation>(ctx, C.allocations, [["invoiceId", "==", inv.id]], 500)).filter((x) => !x.reversed && !x.archived);
        const r = receiptAmount(inv, allocs);
        if (!r.ok) errors.push(r.error);
        const pays = await getMany<Payment>(ctx, C.payments, allocs.map((x) => x.paymentId));
        const rows = allocs
          .map((x) => ({ date: pays.get(x.paymentId)?.date ?? x.allocatedAt?.slice(0, 10) ?? null, amount: x.amount }))
          .sort((x, y) => ((x.date ?? "") < (y.date ?? "") ? -1 : 1));
        a.put("receipt.amount", r.ok ? fmtYen(r.amount) : null);
        a.put("receipt.date", rows.length ? fmtDate(rows.at(-1)!.date) : null);
        a.put("receipt.payerName", s(inv.billToName));
        a.list("receipt.payments", rows.map((x) => ({ date: fmtDate(x.date), amount: fmtYen(x.amount) })));
        stamp = maxStamp(inv, ...allocs);
      }
      break;
    }
    case "settlement": {
      const st = await getDoc<Settlement>(ctx, C.settlements, entityId);
      if (!st) throw new NotFoundError();
      const owner = await getDoc<Party>(ctx, C.parties, st.ownerPartyId);
      const props = await getMany<Property>(ctx, C.properties, st.propertyIds ?? []);
      a.put("settlement.number", s(st.number));
      a.put("settlement.period", fmtYm(st.period));
      a.put("settlement.properties", props.size ? [...props.values()].map((p) => p.name).join("、") : null);
      a.put("owner.name", s(owner?.name));
      a.put("owner.address", s(owner?.address));
      a.put("settlement.collected", fmtYen(st.calc?.collectedTotal));
      a.put("settlement.fee", fmtYen(st.calc?.fee));
      a.put("settlement.feeTax", fmtYen(st.calc?.feeTax));
      a.put("settlement.expenses", fmtYen(st.calc?.expenses));
      a.put("settlement.carryIn", fmtYen(st.calc?.carryIn ?? st.carryIn));
      a.put("settlement.payable", fmtYen(st.calc?.payable));
      a.put("settlement.carryOut", fmtYen(st.calc?.carryOut));
      a.put("settlement.remitted", fmtYen(st.remitted));
      a.list("settlement.expenses", (st.expenses ?? []).map((e) => ({ name: s(e.name), amount: fmtYen(e.amount) })));
      a.list("settlement.basis", st.calc ? (st.calc.basis ?? []).map((t) => ({ text: s(t) })) : null);
      if (props.size === 1) putProperty(a, [...props.values()][0]);
      a.party(st.ownerPartyId);
      a.att("settlement", st.id);
      title = `${st.number} ${owner?.name ?? ""} ${st.period}`.trim();
      entityNumber = st.number;
      stamp = maxStamp(st);
      break;
    }
    case "repair": {
      const rp = await getDoc<Repair>(ctx, C.repairs, entityId);
      if (!rp) throw new NotFoundError();
      ensureStore(ctx, rp.storeId);
      const unit = rp.unitId ? await getDoc<Unit>(ctx, C.units, rp.unitId) : null;
      const property = rp.propertyId || unit ? await getDoc<Property>(ctx, C.properties, rp.propertyId ?? unit!.propertyId) : null;
      const vendor = rp.vendorPartyId ? await getDoc<Party>(ctx, C.parties, rp.vendorPartyId) : null;
      const estId = rp.approvedEstimateId ?? rp.currentEstimateId;
      const est = estId ? await getDoc<Estimate>(ctx, C.estimates, estId) : null;
      putProperty(a, property);
      putUnit(a, unit, property);
      a.put("repair.number", s(rp.number));
      a.put("repair.equipment", s(rp.equipment));
      a.put("repair.symptom", s(rp.symptom));
      a.put("repair.status", labelOf(REPAIR_STATUSES, rp.status));
      a.put("repair.scheduledDate", fmtDate(rp.scheduledDate));
      a.put("repair.completedAt", fmtDate(rp.completedAt));
      a.put("vendor.name", s(vendor?.name));
      a.put("estimate.versionNo", est ? `第${est.versionNo}版` : null);
      a.put("estimate.subtotal", fmtYen(est?.subtotal));
      a.put("estimate.tax", fmtYen(est?.tax));
      a.put("estimate.total", fmtYen(est?.total));
      a.put("estimate.reason", s(est?.reason));
      a.list(
        "estimate.lines",
        est
          ? est.lines.map((l) => ({
              name: s(l.name),
              quantity: s(l.quantity),
              unit: s(l.unit),
              unitPrice: l.unitPrice ? fmtYen(Number(l.unitPrice)) : null,
              amount: fmtYen(l.amount),
              burden: l.burden?.length ? l.burden.map((b) => `${BURDEN_JA[b.party] ?? b.party} ${fmtYen(b.amount)}`).join(" / ") : null,
            }))
          : null,
      );
      a.party(rp.vendorPartyId);
      a.att("repair", rp.id);
      if (est) a.att("estimate", est.id);
      title = `${rp.number} ${rp.symptom ?? ""}`.trim();
      entityNumber = rp.number;
      storeId = rp.storeId;
      stamp = maxStamp(rp, est);
      break;
    }
    case "moveout": {
      const mo = await getDoc<Moveout>(ctx, C.moveouts, entityId);
      if (!mo) throw new NotFoundError();
      const c = await getDoc<Contract>(ctx, C.contracts, mo.contractId);
      if (!c) throw new NotFoundError();
      ensureStore(ctx, c.storeId);
      const r = await putContract(ctx, a, c);
      a.put("moveout.requestedAt", fmtDate(mo.requestedAt));
      a.put("moveout.desiredDate", fmtDate(mo.desiredDate));
      a.put("moveout.confirmedDate", fmtDate(mo.confirmedDate));
      a.put("moveout.inspectionAt", mo.inspectionAt ? (mo.inspectionAt.length > 10 ? fmtDateTime(mo.inspectionAt) : fmtDate(mo.inspectionAt)) : null);
      a.put("moveout.keysReturned", fmtNum(mo.keysReturned, "本"));
      a.list("moveout.burdens", (mo.burdenDecisions ?? []).map((b) => ({ item: s(b.item), party: BURDEN_JA[b.party] ?? s(b.party), amount: fmtYen(b.amount), reason: s(b.reason) })));
      a.put("moveout.burdenTotal", fmtYen((mo.burdenDecisions ?? []).filter((b) => b.party === "lessee" || b.party === "借主").reduce((x, b) => x + (b.amount ?? 0), 0)));
      const deps = (await findDocs<DepositEntryDoc>(ctx, C.deposits, [["contractId", "==", c.id]], 500)).filter((d) => !d.archived);
      const bal = depositBalance(deps);
      const has = deps.length > 0;
      a.put("depositLedger.received", has ? fmtYen(bal.received) : null);
      a.put("depositLedger.applied", has ? fmtYen(bal.applied) : null);
      a.put("depositLedger.refundPlanned", has ? fmtYen(bal.refundPlanned) : null);
      a.put("depositLedger.refunded", has ? fmtYen(bal.refunded) : null);
      a.put("depositLedger.additional", has ? fmtYen(bal.additional) : null);
      a.put("depositLedger.balance", has ? fmtYen(bal.balance) : null);
      a.put("depositLedger.holder", c.depositHolder ? { company: "管理会社", lessor: "貸主", other: "その他" }[c.depositHolder] : null);
      const fin = mo.finalInvoiceId ? await getDoc<Invoice>(ctx, C.invoices, mo.finalInvoiceId) : null;
      a.put("moveout.finalInvoiceTotal", fmtYen(fin?.total));
      a.att("moveout", mo.id);
      title = `${c.number} 退去精算`;
      entityNumber = c.number;
      storeId = c.storeId;
      stamp = maxStamp(mo, c, r.version, fin, ...deps);
      break;
    }
    case "renewal": {
      const rn = await getDoc<Renewal>(ctx, C.renewals, entityId);
      if (!rn) throw new NotFoundError();
      const c = await getDoc<Contract>(ctx, C.contracts, rn.contractId);
      if (!c) throw new NotFoundError();
      ensureStore(ctx, c.storeId);
      const r = await putContract(ctx, a, c);
      a.put("renewal.expiresOn", fmtDate(rn.expiresOn));
      a.put("renewal.noticeDeadline", fmtDate(rn.noticeDeadline));
      a.put("renewal.proposedRent", fmtYen(rn.proposedTerms?.rent));
      a.put("renewal.proposedFee", fmtYen(rn.proposedTerms?.fee));
      a.put("renewal.proposedTermMonths", fmtNum(rn.proposedTerms?.termMonths ?? null, "か月"));
      a.put("renewal.note", s(rn.proposedTerms?.note));
      a.att("renewal", rn.id);
      title = `${c.number} 更新（満了 ${rn.expiresOn}）`;
      entityNumber = c.number;
      storeId = c.storeId;
      stamp = maxStamp(rn, c, r.version);
      break;
    }
    case "deal": {
      const d = await getDoc<Deal>(ctx, C.deals, entityId);
      if (!d) throw new NotFoundError();
      ensureStore(ctx, d.storeId);
      const customer = d.customerId ? await getDoc<Party>(ctx, C.parties, d.customerId) : null;
      a.put("deal.number", s(d.number));
      a.put("deal.title", s(d.title));
      a.put("deal.kind", d.kind === "sale" ? "売買" : "賃貸");
      a.put("deal.conditions", s(d.conditions));
      a.put("deal.assignee", d.assigneeUid ? await staffName(ctx, d.assigneeUid) : null);
      putParty(a, "customer", customer);
      a.party(d.customerId);
      const props = await getMany<Property>(ctx, C.properties, d.propertyIds ?? []);
      const units = await getMany<Unit>(ctx, C.units, d.unitIds ?? []);
      const rows: ListRow[] = [];
      for (const pid of d.propertyIds ?? []) {
        const p = props.get(pid);
        if (!p) continue;
        const u = [...units.values()].find((x) => x.propertyId === pid) ?? null;
        const l = await currentListing(ctx, pid, u?.id ?? null);
        rows.push({
          number: s(p.number), name: s(p.name + (u ? ` ${u.number}` : "")), address: s(p.address), layout: s(u?.layout),
          area: areaLabel(u?.areas ?? p.areas, ["exclusive", "floor_total", "land"]),
          rent: fmtYen(l?.rent), commonFee: fmtYen(l?.commonFee), deposit: fmtYen(l?.deposit), keyMoney: fmtYen(l?.keyMoney),
          price: fmtYen(l?.price), availableFrom: fmtDate(l?.availableFrom ?? u?.availableFrom),
        });
        a.att("property", pid);
      }
      a.list("deal.properties", rows);
      if (props.size >= 1) {
        const p0 = props.get(d.propertyIds[0]) ?? null;
        const u0 = p0 ? [...units.values()].find((x) => x.propertyId === p0.id) ?? null : null;
        putProperty(a, p0);
        putUnit(a, u0, p0);
        putListing(a, p0 ? await currentListing(ctx, p0.id, u0?.id ?? null) : null);
      }
      const evs = (await findDocs<EventDoc>(ctx, C.events, [["dealId", "==", d.id]], 200)).filter((e) => e.type === "viewing" && !e.archived);
      evs.sort((x, y) => (x.start < y.start ? -1 : 1));
      const evProps = await getMany<Property>(ctx, C.properties, evs.map((e) => e.propertyId ?? ""));
      a.list("deal.viewings", evs.length ? evs.map((e) => ({ at: fmtDateTime(e.start), place: s(e.place), property: s(e.propertyId ? evProps.get(e.propertyId)?.name : null), keyPickup: s(e.keyPickup) })) : null);
      a.list("deal.requiredDocs", await requiredDocs(ctx, d.id));
      a.att("deal", d.id);
      title = `${d.number} ${d.title ?? ""}`.trim();
      entityNumber = d.number;
      storeId = d.storeId;
      stamp = maxStamp(d, ...props.values(), ...evs);
      break;
    }
    case "property": {
      const p = await getDoc<Property>(ctx, C.properties, entityId);
      if (!p) throw new NotFoundError();
      const units = (await findDocs<Unit>(ctx, C.units, [["propertyId", "==", p.id]], 500)).filter((u) => !u.archived);
      units.sort((x, y) => x.number.localeCompare(y.number, "ja", { numeric: true }));
      putProperty(a, p);
      const l = await currentListing(ctx, p.id, null);
      putListing(a, l);
      a.list("property.units", units.map((u) => ({ number: s(u.number), layout: s(u.layout), area: areaLabel(u.areas, ["exclusive"]), occupancy: OCC_JA[u.occupancy] ?? null })));
      title = p.name;
      entityNumber = p.number;
      stamp = maxStamp(p, l);
      break;
    }
  }

  a.put("company.name", s(await companyName(ctx.companyId)));
  a.put("doc.date", fmtDate(todayJst()));
  a.put("doc.number", null); // 作成時に採番して設定
  return {
    data: {
      fields: a.fields,
      lists: a.lists,
      meta: {
        entity,
        entityId,
        entityNumber,
        entityTitle: title,
        sourceUpdatedAt: stamp,
        candidatePartyIds: [...a.parties],
        attachEntities: a.attach,
        builtAt: nowIso(),
      },
    },
    title,
    storeId,
    errors,
  };
}

async function requiredDocs(ctx: Ctx, dealId: string): Promise<ListRow[] | null> {
  const apps = (await findDocs<ApplicationDoc>(ctx, C.applications, [["dealId", "==", dealId]], 50)).filter((x) => !x.archived);
  if (!apps.length) return null;
  const m = new Map<string, boolean>();
  for (const ap of apps) for (const d of ap.submittedDocs ?? []) m.set(d.name, (m.get(d.name) ?? false) || d.received);
  return [...m.entries()].map(([name, received]) => ({ name: s(name), status: received ? "受領済み" : "未受領" }));
}
