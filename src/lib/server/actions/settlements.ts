"use server";
import { adminDb } from "../firebase-admin";
import { requireStaff } from "../session";
import { run, str, optStr, optYen, ActionResult } from "../action";
import { ValidationError, txGet, txCreate, txUpdate, audit, txNextNumber, runOnce, getDoc, mustGet, findDocs, col, ref, nowIso, BaseDoc, keywords } from "../repo";
import { C, Allocation, Party, Remittance, Settlement } from "@/lib/types";
import { isValidBizDate } from "@/lib/domain/dates";
import { deriveRemittanceStatus } from "@/lib/domain/rules";
import { isValidPeriod, periodOf } from "@/lib/domain/billing";
import { computeSettlementData, SettlementExtra, txAssertPeriodsOpen } from "../jobs/billing";

// S18 オーナー精算: 計算中 → 確認待ち → 確定 → 送金記録（一部記録済み／記録済み）。訂正は別の精算として作成する。
// 回収済みの入金配分のみを対象とし（B17）、確定時に配分へ精算IDを設定して再利用を防ぐ（B19）。

type SettlementDoc = Settlement & SettlementExtra & { keywords?: string[] };

function parseExpenses(raw: unknown, allowNegative: boolean): { name: string; amount: number; repairId: string | null }[] {
  if (!raw) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(String(raw));
  } catch {
    throw new ValidationError(["立替費用の入力内容を読み取れません"]);
  }
  if (!Array.isArray(arr)) return [];
  const errs: string[] = [];
  const out = arr
    .map((x, i) => {
      const o = x as Record<string, unknown>;
      const name = str(o.name);
      const s = str(o.amount).normalize("NFKC").replace(/[,¥円]/g, "");
      if (!name && !s) return null;
      const amount = Number(s);
      if (!name) errs.push(`立替費用${i + 1}行目: 名称を入力してください`);
      if (!Number.isInteger(amount) || s === "") errs.push(`立替費用${i + 1}行目: 金額は円単位の整数で入力してください`);
      else if (amount < 0 && !allowNegative) errs.push(`立替費用${i + 1}行目: マイナスは訂正精算でのみ入力できます`);
      return { name, amount, repairId: optStr(o.repairId) };
    })
    .filter((x): x is { name: string; amount: number; repairId: string | null } => !!x);
  if (errs.length) throw new ValidationError(errs, { expenses: errs[0] });
  return out;
}

function computedPatch(c: Awaited<ReturnType<typeof computeSettlementData>>) {
  return {
    propertyIds: c.propertyIds,
    allocationIds: c.allocationIds,
    calc: c.calc,
    ownerSplit: c.ownerSplit,
    ownerShares: c.ownerShares,
    remainderTo: c.remainderTo,
    depositTotal: c.depositTotal,
    collectedDetail: c.collectedDetail.slice(0, 2000),
  };
}

export async function createSettlement(v: Record<string, unknown>): Promise<ActionResult<{ redirect: string }>> {
  return run(async () => {
    const ctx = await requireStaff("settlement.write");
    const fe: Record<string, string> = {};
    const ownerPartyId = str(v.ownerPartyId);
    const period = str(v.period);
    if (!ownerPartyId) fe.ownerPartyId = "オーナーを選択してください";
    if (!isValidPeriod(period)) fe.period = "対象月を選択してください";
    if (Object.keys(fe).length) throw new ValidationError(Object.values(fe), fe);
    const owner = await getDoc<Party>(ctx, C.parties, ownerPartyId);
    if (!owner) throw new ValidationError(["オーナーが見つかりません"]);
    const same = (await findDocs<SettlementDoc>(ctx, C.settlements, [["ownerPartyId", "==", ownerPartyId], ["period", "==", period]], 50)).filter(
      (s) => !s.archived && !s.correctionOf && s.status !== "corrected",
    );
    if (same.length) throw new ValidationError([`このオーナーの ${period} の精算は既に作成されています（${same[0].number}）。変更は訂正精算で行ってください`]);
    // 前回繰越: 直前の確定済み精算の繰越額（マイナス）
    const prev = (await findDocs<SettlementDoc>(ctx, C.settlements, [["ownerPartyId", "==", ownerPartyId]], 500))
      .filter((s) => s.period < period && ["confirmed", "partially_remitted", "remitted"].includes(s.status) && s.calc)
      .sort((a, b) => b.period.localeCompare(a.period))[0];
    const carryIn = prev?.calc?.carryOut ?? 0;
    const comp = await computeSettlementData(ctx, ownerPartyId, period, [], carryIn);
    const id = await runOnce(ctx, str(v._requestId), async (tx) => {
      await txAssertPeriodsOpen(tx, ctx, [period], "精算の作成");
      const number = await txNextNumber(tx, ctx, "settlement", "S-");
      const nid = txCreate(tx, ctx, C.settlements, {
        number, ownerPartyId, period, status: "calculating", expenses: [], carryIn, remitted: 0, confirmedBy: null, confirmedAt: null,
        correctionOf: null, publishedToOwner: false, expenseRepairIds: [], correctedBy: null,
        note: prev && carryIn ? `前回繰越: ${prev.number}` : null,
        keywords: keywords(number, owner.name, owner.kana, period),
        ...computedPatch(comp),
      } satisfies Omit<SettlementDoc, keyof BaseDoc>);
      audit(tx, ctx, "settlement.create", C.settlements, nid, { number, period, payable: comp.calc.payable });
      return nid;
    });
    return { redirect: `/settlements/${id}` };
  });
}

/** 計算中の精算: 立替費用・繰越を保存し、対象入金を読み直して再計算する */
export async function saveSettlementInputs(v: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff("settlement.write");
    const id = str(v.id);
    const s = await mustGet<SettlementDoc>(ctx, C.settlements, id);
    if (s.status !== "calculating") throw new ValidationError(["計算中の精算だけ変更できます（確認待ちは「計算中に戻す」）"]);
    const expenses = v.expenses === undefined ? s.expenses : parseExpenses(v.expenses, !!s.correctionOf);
    const fe: Record<string, string> = {};
    const carryIn = v.carryIn === undefined ? s.carryIn : optYen(v.carryIn, "carryIn", fe) ?? 0;
    if (Object.keys(fe).length) throw new ValidationError(Object.values(fe), fe);
    const comp = await computeSettlementData(ctx, s.ownerPartyId, s.period, expenses, carryIn);
    await adminDb().runTransaction(async (tx) => {
      const cur = await txGet<SettlementDoc>(tx, ctx, C.settlements, id);
      if (cur.status !== "calculating") throw new ValidationError(["計算中の精算だけ変更できます"]);
      await txAssertPeriodsOpen(tx, ctx, [cur.period], "精算の変更");
      txUpdate(tx, ctx, C.settlements, cur, v._version === undefined || v._version === null ? null : Number(v._version), {
        expenses,
        carryIn,
        note: optStr(v.note) ?? cur.note ?? null,
        expenseRepairIds: [...new Set(expenses.map((e) => e.repairId).filter((x): x is string => !!x))],
        ...computedPatch(comp),
      });
      audit(tx, ctx, "settlement.calc", C.settlements, id, { expenses: comp.calc.expenses, carryIn, payable: comp.calc.payable, allocations: comp.allocationIds.length });
    });
    return null;
  });
}

export async function submitSettlement(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff("settlement.write");
    await adminDb().runTransaction(async (tx) => {
      const s = await txGet<SettlementDoc>(tx, ctx, C.settlements, str(input.id));
      if (s.status !== "calculating") throw new ValidationError(["計算中の精算だけ確認へ進めます"]);
      if (!s.calc) throw new ValidationError(["計算結果がありません。再計算してください"]);
      txUpdate(tx, ctx, C.settlements, s, null, { status: "review" });
      audit(tx, ctx, "settlement.submit", C.settlements, s.id, {});
    });
    return null;
  });
}

export async function backToCalculating(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff("settlement.write");
    const reason = str(input.reason);
    if (!reason) throw new ValidationError(["差戻しの理由を入力してください"]);
    await adminDb().runTransaction(async (tx) => {
      const s = await txGet<SettlementDoc>(tx, ctx, C.settlements, str(input.id));
      if (s.status !== "review") throw new ValidationError(["確認待ちの精算だけ戻せます"]);
      txUpdate(tx, ctx, C.settlements, s, null, { status: "calculating" });
      audit(tx, ctx, "settlement.return", C.settlements, s.id, { reason });
    });
    return null;
  });
}

/**
 * 確定（B19）: 対象の配分を読み直し、取消済み・他の精算で使用済みのものがあれば確定しない。
 * 同じトランザクションで配分に精算IDを設定し、再利用を防ぐ。
 */
export async function confirmSettlement(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff("settlement.confirm");
    const id = str(input.id);
    await runOnce(ctx, str(input._requestId), async (tx) => {
      const s = await txGet<SettlementDoc>(tx, ctx, C.settlements, id);
      if (s.status !== "review") throw new ValidationError(["確認待ちの精算だけ確定できます"]);
      if (!s.calc) throw new ValidationError(["計算結果がありません"]);
      const snaps = s.allocationIds.length ? await tx.getAll(...s.allocationIds.map((a) => ref(ctx, C.allocations, a))) : [];
      const allocs = snaps.map((x) => ({ ...(x.data() as Allocation), id: x.id, _exists: x.exists }));
      const bad = allocs.filter((a) => !a._exists || a.companyId !== ctx.companyId || a.reversed || (a.settlementId && a.settlementId !== id));
      if (bad.length) {
        throw new ValidationError([`対象の入金配分のうち ${bad.length}件が取消済み、または他の精算で使用済みです。計算中に戻して再計算してください`]);
      }
      const repairIds = s.expenseRepairIds ?? [];
      if (repairIds.length) {
        const other = await tx.get(col(ctx.companyId, C.settlements).where("expenseRepairIds", "array-contains-any", repairIds.slice(0, 30)));
        const clash = other.docs.filter((d) => d.id !== id && d.data().status !== "corrected" && ["confirmed", "partially_remitted", "remitted"].includes(d.data().status));
        if (clash.length) throw new ValidationError(["立替費用の修繕が他の確定済み精算に含まれています。立替費用を確認してください"]);
      }
      const orig = s.correctionOf ? await txGet<SettlementDoc>(tx, ctx, C.settlements, s.correctionOf) : null;
      await txAssertPeriodsOpen(tx, ctx, [s.period], "精算の確定");
      for (const a of allocs) {
        const { _exists, ...rest } = a;
        void _exists;
        txUpdate(tx, ctx, C.allocations, rest, null, { settlementId: id });
      }
      txUpdate(tx, ctx, C.settlements, s, null, { status: s.calc.payable > 0 ? "confirmed" : "remitted", confirmedBy: ctx.uid, confirmedAt: nowIso() });
      if (orig) txUpdate(tx, ctx, C.settlements, orig, null, { status: "corrected", correctedBy: id });
      audit(tx, ctx, "settlement.confirm", C.settlements, id, { payable: s.calc.payable, allocations: s.allocationIds.length, correctionOf: s.correctionOf });
      return null;
    });
    return null;
  });
}

/** 送金記録（送金自体は外部で実施）。記録額が予定額と一致するまで完了扱いにしない */
export async function addRemittance(v: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff("settlement.write");
    const id = str(v.settlementId);
    const fe: Record<string, string> = {};
    const date = str(v.date);
    if (!isValidBizDate(date)) fe.date = "送金日を入力してください";
    const amount = optYen(v.amount, "amount", fe);
    if (amount === null && !fe.amount) fe.amount = "送金額を入力してください";
    else if (amount !== null && amount <= 0) fe.amount = "送金額は1円以上で入力してください";
    const ownerPartyId = str(v.ownerPartyId);
    if (Object.keys(fe).length) throw new ValidationError(Object.values(fe), fe);
    await runOnce(ctx, str(v._requestId), async (tx) => {
      const s = await txGet<SettlementDoc>(tx, ctx, C.settlements, id);
      if (!["confirmed", "partially_remitted"].includes(s.status) || !s.calc) throw new ValidationError(["確定済みで送金が完了していない精算にだけ記録できます"]);
      const owner = ownerPartyId || s.ownerPartyId;
      if (!s.ownerSplit.some((o) => o.ownerId === owner)) throw new ValidationError(["送金先がこの精算の配分先に含まれていません"]);
      const remitted = s.remitted + amount!;
      if (remitted > s.calc.payable) throw new ValidationError([`送金記録の合計（${remitted.toLocaleString()}円）が送金予定額（${s.calc.payable.toLocaleString()}円）を超えます`]);
      await txAssertPeriodsOpen(tx, ctx, [periodOf(date)], "送金記録");
      const rid = txCreate(tx, ctx, C.remittances, { settlementId: id, ownerPartyId: owner, date, amount: amount!, attachmentId: optStr(v.attachmentId), note: optStr(v.note) } satisfies Omit<Remittance, keyof BaseDoc>);
      txUpdate(tx, ctx, C.settlements, s, null, { remitted, status: deriveRemittanceStatus(s.calc.payable, remitted) });
      audit(tx, ctx, "remittance.create", C.remittances, rid, { settlementId: id, date, amount });
      return null;
    });
    return null;
  });
}

/** オーナーページへの公開・非公開（確定済みのみ） */
export async function setSettlementPublished(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff("settlement.confirm");
    const publish = input.publish === true || input.publish === "true";
    await adminDb().runTransaction(async (tx) => {
      const s = await txGet<SettlementDoc>(tx, ctx, C.settlements, str(input.id));
      if (publish && !["confirmed", "partially_remitted", "remitted"].includes(s.status)) throw new ValidationError(["確定済みの精算だけ公開できます"]);
      txUpdate(tx, ctx, C.settlements, s, null, { publishedToOwner: publish });
      audit(tx, ctx, publish ? "settlement.publish" : "settlement.unpublish", C.settlements, s.id, {});
    });
    return null;
  });
}

/**
 * 確定後の訂正（B19）: 元の精算は変更せず、訂正精算（correctionOf）を作成する。
 * 訂正精算には未精算の入金配分と、差額調整の費用（マイナス可）を入れて確定する。確定すると元の精算は「訂正済み」になる。
 */
export async function createSettlementCorrection(input: Record<string, unknown>): Promise<ActionResult<{ redirect: string }>> {
  return run(async () => {
    const ctx = await requireStaff("settlement.write");
    const reason = str(input.reason);
    if (!reason) throw new ValidationError(["訂正の理由を入力してください"]);
    const orig = await mustGet<SettlementDoc>(ctx, C.settlements, str(input.id));
    if (!["confirmed", "partially_remitted", "remitted"].includes(orig.status)) throw new ValidationError(["確定済みの精算だけ訂正できます"]);
    const comp = await computeSettlementData(ctx, orig.ownerPartyId, orig.period, [], 0);
    const id = await runOnce(ctx, str(input._requestId), async (tx) => {
      const cur = await txGet<SettlementDoc>(tx, ctx, C.settlements, orig.id);
      if (cur.correctedBy) {
        const existing = await tx.get(ref(ctx, C.settlements, cur.correctedBy));
        if (existing.exists && existing.data()!.status !== "confirmed") throw new ValidationError(["作成済みの訂正精算があります"]);
      }
      await txAssertPeriodsOpen(tx, ctx, [orig.period], "訂正精算の作成");
      const number = await txNextNumber(tx, ctx, "settlement", "S-");
      const nid = txCreate(tx, ctx, C.settlements, {
        number, ownerPartyId: orig.ownerPartyId, period: orig.period, status: "calculating", expenses: [], carryIn: 0, remitted: 0,
        confirmedBy: null, confirmedAt: null, correctionOf: orig.id, publishedToOwner: false, expenseRepairIds: [], correctedBy: null,
        note: `訂正: ${reason}（元精算 ${orig.number}）`, keywords: keywords(number, orig.number, orig.period),
        ...computedPatch(comp),
      } satisfies Omit<SettlementDoc, keyof BaseDoc>);
      txUpdate(tx, ctx, C.settlements, cur, null, { correctedBy: nid });
      audit(tx, ctx, "settlement.correction", C.settlements, orig.id, { correctionId: nid, reason });
      return nid;
    });
    return { redirect: `/settlements/${id}` };
  });
}
