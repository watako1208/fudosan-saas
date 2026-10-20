"use server";
import { adminDb } from "../firebase-admin";
import { requireStaff, canAccessStore } from "../session";
import { run, str, optStr, optYen, ActionResult } from "../action";
import { ValidationError, NotFoundError, txGet, txCreate, txUpdate, audit, keywords, runOnce, col, nowIso, BaseDoc } from "../repo";
import { C, Contract, ContractVersion, Renewal, Moveout, Unit, DepositEntryDoc } from "@/lib/types";
import { isValidBizDate, todayJst, compare } from "@/lib/domain/dates";
import { MOVEOUT_STATUSES, depositBalance } from "@/lib/domain/rules";
import { renewedPeriod, previousEffectiveTo } from "@/lib/domain/contracts";
import { extractRenewalsAs } from "../jobs/renewals";

const RENT_CODES = ["rent", "rent_commercial", "parking"];

function expected(v: unknown): number | null {
  return v === null || v === undefined || v === "" ? null : Number(v);
}

// ───────────── 更新管理（S21） ─────────────

export async function runRenewalExtraction(input: Record<string, unknown>): Promise<ActionResult<{ created: number; skipped: number }>> {
  return run(async () => {
    const ctx = await requireStaff("lease.write");
    void input;
    return extractRenewalsAs(ctx, todayJst());
  });
}

const RENEWAL_EDITABLE: Renewal["status"][] = ["extracted", "notified", "answered", "documents"];
const ANSWERS: Renewal["answer"][] = ["pending", "accept", "decline", "negotiating"];

export async function updateRenewal(id: string, v: Record<string, unknown>): Promise<ActionResult<{ redirect: string }>> {
  return run(async () => {
    const ctx = await requireStaff("lease.write");
    const fe: Record<string, string> = {};
    const status = str(v.status) as Renewal["status"];
    if (!RENEWAL_EDITABLE.includes(status)) fe.status = "手続き状態を選択してください（更新の確定は「更新を確定」ボタンで行います）";
    const answer = str(v.answer) as Renewal["answer"];
    if (!ANSWERS.includes(answer)) fe.answer = "回答を選択してください";
    const rent = optYen(v.proposedRent, "proposedRent", fe);
    const fee = optYen(v.proposedFee, "proposedFee", fe);
    const tm = str(v.proposedTermMonths);
    const termMonths = tm === "" ? null : Number(tm);
    if (termMonths !== null && (!Number.isInteger(termMonths) || termMonths < 1 || termMonths > 600)) fe.proposedTermMonths = "1〜600の整数で入力してください";
    if (Object.keys(fe).length) throw new ValidationError(Object.values(fe), fe);
    await adminDb().runTransaction(async (tx) => {
      const r = await txGet<Renewal>(tx, ctx, C.renewals, id);
      if (!RENEWAL_EDITABLE.includes(r.status)) throw new ValidationError(["確定・中止済みの更新は編集できません"]);
      const patch = { status, answer, proposedTerms: { rent, fee, termMonths, note: optStr(v.proposedNote) } };
      txUpdate(tx, ctx, C.renewals, r, expected(v._version), patch);
      audit(tx, ctx, "update", C.renewals, id, patch);
    });
    return { redirect: `/lease/renewals/${id}` };
  });
}

/** 更新を確定: 提示条件で新しい契約版を作成する（抽出されただけでは確定しない） */
export async function confirmRenewal(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff("lease.write");
    await runOnce(ctx, str(input._requestId), async (tx) => {
      const r = await txGet<Renewal>(tx, ctx, C.renewals, str(input.id));
      const c = await txGet<Contract>(tx, ctx, C.contracts, r.contractId);
      if (!c.currentVersionId) throw new ValidationError(["契約条件（版）が見つかりません"]);
      const cur = await txGet<ContractVersion>(tx, ctx, C.contractVersions, c.currentVersionId);
      const all = (await tx.get(col(ctx.companyId, C.contractVersions).where("contractId", "==", c.id))).docs.map((d) => d.data() as ContractVersion);

      if (!RENEWAL_EDITABLE.includes(r.status)) throw new ValidationError(["確定・中止済みの更新です"]);
      if (r.answer !== "accept") throw new ValidationError(["回答が「更新する」になっていません。回答を記録してから確定してください"]);
      if (!["executed", "active"].includes(c.status)) throw new ValidationError(["締結記録済み・契約期間中の契約のみ更新できます"]);
      if (!canAccessStore(ctx, c.storeId)) throw new ValidationError(["この店舗の契約を更新する権限がありません"]);
      if (c.end !== r.expiresOn) throw new ValidationError([`契約終了日（${c.end ?? "未設定"}）が更新対象の満了日（${r.expiresOn}）と一致しません。契約を確認してください`]);
      if (all.some((x) => x.status === "draft" && !x.archived)) throw new ValidationError(["未確定の条件変更版があります。先に確定または破棄してください"]);
      const termMonths = r.proposedTerms?.termMonths ?? cur.renewal?.termMonths ?? null;
      if (!termMonths) throw new ValidationError(["更新期間（か月）を提示条件に入力してください"]);

      const { effectiveFrom, newEnd } = renewedPeriod(r.expiresOn, termMonths);
      const rent = r.proposedTerms?.rent ?? null;
      let rentApplied = false;
      const monthlyItems = cur.monthlyItems.map((m) => {
        if (rent !== null && !rentApplied && RENT_CODES.includes(m.code)) {
          rentApplied = true;
          return { ...m, amount: rent };
        }
        return m;
      });
      if (rent !== null && !rentApplied) throw new ValidationError(["契約の月額費用に賃料の費目がないため、提示賃料を反映できません"]);
      const copy = Object.fromEntries(Object.entries(cur).filter(([k]) => !["id", "companyId", "createdAt", "updatedAt", "createdBy", "updatedBy", "version", "archived"].includes(k)));
      const versionNo = Math.max(...all.map((x) => x.versionNo)) + 1;
      const nid = txCreate(tx, ctx, C.contractVersions, {
        ...(copy as Omit<ContractVersion, keyof BaseDoc>),
        versionNo,
        effectiveFrom,
        effectiveTo: null,
        status: "confirmed",
        confirmedBy: ctx.uid,
        confirmedAt: nowIso(),
        end: newEnd,
        monthlyItems,
        renewal: { termMonths, fee: r.proposedTerms?.fee ?? cur.renewal?.fee ?? null, noticeRule: cur.renewal?.noticeRule ?? null },
        changeReason: `契約更新（${r.expiresOn}満了 → ${newEnd}まで）${r.proposedTerms?.note ? `: ${r.proposedTerms.note}` : ""}`,
      });
      txUpdate(tx, ctx, C.contractVersions, cur, null, { effectiveTo: previousEffectiveTo(effectiveFrom) });
      txUpdate(tx, ctx, C.contracts, c, null, {
        currentVersionId: nid,
        end: newEnd,
        approvals: [
          ...(c.approvals ?? []),
          { action: "approve", by: ctx.uid, byName: ctx.user.displayName, at: nowIso(), reason: `契約更新を確定（第${versionNo}版・${effectiveFrom}〜${newEnd}）`, versionId: nid },
        ],
      });
      txUpdate(tx, ctx, C.renewals, r, null, { status: "completed", newVersionId: nid });
      audit(tx, ctx, "renewal.confirm", C.renewals, r.id, { contractId: c.id, versionId: nid, effectiveFrom, newEnd, rent, termMonths });
      return null;
    });
    return null;
  });
}

export async function cancelRenewal(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff("lease.write");
    const reason = optStr(input.reason);
    if (!reason) throw new ValidationError(["中止理由を入力してください"]);
    await adminDb().runTransaction(async (tx) => {
      const r = await txGet<Renewal>(tx, ctx, C.renewals, str(input.id));
      if (!RENEWAL_EDITABLE.includes(r.status)) throw new ValidationError(["確定・中止済みの更新です"]);
      txUpdate(tx, ctx, C.renewals, r, null, { status: "cancelled", cancelReason: reason });
      audit(tx, ctx, "renewal.cancel", C.renewals, r.id, { reason });
    });
    return null;
  });
}

// ───────────── 解約・退去（S22） ─────────────

const MO_KEYS = MOVEOUT_STATUSES.map(([k]) => k) as string[];

export async function createMoveout(v: Record<string, unknown>): Promise<ActionResult<{ redirect: string }>> {
  return run(async () => {
    const ctx = await requireStaff("lease.write");
    const fe: Record<string, string> = {};
    const contractId = str(v.contractId);
    if (!contractId) fe.contractId = "契約を指定してください";
    const requestedAt = str(v.requestedAt);
    if (!isValidBizDate(requestedAt)) fe.requestedAt = "申出日を入力してください";
    const desiredDate = optStr(v.desiredDate);
    if (desiredDate && !isValidBizDate(desiredDate)) fe.desiredDate = "日付が正しくありません";
    if (Object.keys(fe).length) throw new ValidationError(Object.values(fe), fe);
    const id = await runOnce(ctx, str(v._requestId), async (tx) => {
      const c = await txGet<Contract>(tx, ctx, C.contracts, contractId);
      const open = (await tx.get(col(ctx.companyId, C.moveouts).where("contractId", "==", contractId))).docs
        .map((d) => d.data() as Moveout)
        .filter((m) => m.status !== "completed" && !m.archived);
      const unit = c.unitId ? await txGet<Unit>(tx, ctx, C.units, c.unitId) : null;
      if (c.kind !== "lease" || !["executed", "active"].includes(c.status)) throw new ValidationError(["締結記録済み・契約期間中の賃貸契約のみ解約を登録できます"]);
      if (!canAccessStore(ctx, c.storeId)) throw new ValidationError(["この店舗の契約を操作する権限がありません"]);
      if (open.length) throw new ValidationError(["この契約には手続き中の解約・退去があります"]);
      const mid = txCreate(tx, ctx, C.moveouts, {
        contractId, unitId: c.unitId, requestedAt, desiredDate, confirmedDate: null, inspectionAt: null, keysReturned: null, status: "requested",
        finalInvoiceId: null, repairIds: [], burdenDecisions: [], impactNote: optStr(v.impactNote),
        keywords: keywords(c.number, c.title), contractNumber: c.number, contractTitle: c.title, storeId: c.storeId,
      } satisfies Omit<Moveout, keyof BaseDoc> & Record<string, unknown>);
      // 入居状態（B02）: 退去予定にする。募集状態は別項目のため変更しない
      if (unit && unit.currentContractId === c.id) txUpdate(tx, ctx, C.units, unit, null, { occupancy: "notice_given", expectedVacancyDate: desiredDate });
      audit(tx, ctx, "moveout.create", C.moveouts, mid, { contractId, requestedAt, desiredDate });
      return mid;
    });
    return { redirect: `/lease/moveouts/${id}` };
  });
}

export async function updateMoveout(id: string, v: Record<string, unknown>): Promise<ActionResult<{ redirect: string }>> {
  return run(async () => {
    const ctx = await requireStaff("lease.write");
    const fe: Record<string, string> = {};
    const dates: Record<string, string | null> = {};
    for (const f of ["requestedAt", "desiredDate", "confirmedDate"]) {
      const d = optStr(v[f]);
      if (d && !isValidBizDate(d)) fe[f] = "日付が正しくありません";
      dates[f] = d;
    }
    if (!dates.requestedAt) fe.requestedAt = "申出日を入力してください";
    const inspectionAt = optStr(v.inspectionAt);
    if (inspectionAt && Number.isNaN(Date.parse(inspectionAt))) fe.inspectionAt = "日時が正しくありません";
    const keysStr = str(v.keysReturned);
    const keysReturned = keysStr === "" ? null : Number(keysStr);
    if (keysReturned !== null && (!Number.isInteger(keysReturned) || keysReturned < 0)) fe.keysReturned = "0以上の整数で入力してください";
    const status = str(v.status);
    if (!MO_KEYS.includes(status) || status === "completed") fe.status = "手続き状態を選択してください（完了は「退去精算を完了」で行います）";
    if (MO_KEYS.indexOf(status) >= MO_KEYS.indexOf("date_fixed") && !dates.confirmedDate) fe.confirmedDate = "「解約日確定」以降の状態には確認済み解約日が必要です";
    if (Object.keys(fe).length) throw new ValidationError(Object.values(fe), fe);
    await adminDb().runTransaction(async (tx) => {
      const m = await txGet<Moveout>(tx, ctx, C.moveouts, id);
      const c = await txGet<Contract>(tx, ctx, C.contracts, m.contractId);
      const unit = m.unitId ? await txGet<Unit>(tx, ctx, C.units, m.unitId) : null;
      if (m.status === "completed") throw new ValidationError(["完了した解約・退去は編集できません"]);
      if (dates.confirmedDate && c.start && compare(dates.confirmedDate, c.start) < 0) throw new ValidationError(["解約日が契約開始日より前です"], { confirmedDate: "契約開始日より前です" });
      const patch = {
        requestedAt: dates.requestedAt!, desiredDate: dates.desiredDate, confirmedDate: dates.confirmedDate, inspectionAt, keysReturned, status,
        impactNote: optStr(v.impactNote),
      };
      txUpdate(tx, ctx, C.moveouts, m, expected(v._version), patch);
      const vacancy = dates.confirmedDate ?? dates.desiredDate;
      if (unit && unit.currentContractId === c.id && unit.expectedVacancyDate !== vacancy) txUpdate(tx, ctx, C.units, unit, null, { expectedVacancyDate: vacancy });
      audit(tx, ctx, "update", C.moveouts, id, { ...patch, previousConfirmedDate: m.confirmedDate });
    });
    return { redirect: `/lease/moveouts/${id}` };
  });
}

/** 費用負担の判断（理由・確認者必須）。写真だけから負担者を断定しないよう、判断理由を記録する */
export async function addBurdenDecision(moveoutId: string, v: Record<string, unknown>): Promise<ActionResult<{ redirect: string }>> {
  return run(async () => {
    const ctx = await requireStaff("lease.write");
    const fe: Record<string, string> = {};
    const item = str(v.item);
    if (!item) fe.item = "項目を入力してください";
    const party = str(v.party);
    if (!["lessee", "lessor", "company", "other"].includes(party)) fe.party = "負担者を選択してください";
    const amount = optYen(v.amount, "amount", fe);
    if (amount === null && !fe.amount) fe.amount = "金額を入力してください";
    const reason = str(v.reason);
    if (!reason) fe.reason = "判断理由を入力してください";
    const checkedBy = str(v.checkedBy);
    if (!checkedBy) fe.checkedBy = "確認者を選択してください";
    if (Object.keys(fe).length) throw new ValidationError(Object.values(fe), fe);
    await runOnce(ctx, str(v._requestId), async (tx) => {
      const m = await txGet<Moveout>(tx, ctx, C.moveouts, moveoutId);
      if (m.status === "completed") throw new ValidationError(["完了した解約・退去は編集できません"]);
      const row = { item, party, amount: amount!, reason, checkedBy };
      txUpdate(tx, ctx, C.moveouts, m, null, { burdenDecisions: [...(m.burdenDecisions ?? []), row] });
      audit(tx, ctx, "moveout.burden_add", C.moveouts, m.id, row);
      return null;
    });
    return { redirect: `/lease/moveouts/${moveoutId}?tab=burden` };
  });
}

export async function removeBurdenDecision(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff("lease.write");
    const index = Number(input.index);
    const reason = optStr(input.reason);
    if (!reason) throw new ValidationError(["取り消す理由を入力してください"]);
    await adminDb().runTransaction(async (tx) => {
      const m = await txGet<Moveout>(tx, ctx, C.moveouts, str(input.id));
      if (m.status === "completed") throw new ValidationError(["完了した解約・退去は編集できません"]);
      const row = m.burdenDecisions?.[index];
      if (!row) throw new NotFoundError();
      txUpdate(tx, ctx, C.moveouts, m, null, { burdenDecisions: m.burdenDecisions.filter((_, i) => i !== index) });
      audit(tx, ctx, "moveout.burden_remove", C.moveouts, m.id, { row, reason });
    });
    return null;
  });
}

/** 退去精算を完了: 契約を終了し、部屋を空室にする（現在契約がこの契約の場合のみ） */
export async function completeMoveout(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff("lease.write");
    await runOnce(ctx, str(input._requestId), async (tx) => {
      const m = await txGet<Moveout>(tx, ctx, C.moveouts, str(input.id));
      const c = await txGet<Contract>(tx, ctx, C.contracts, m.contractId);
      const unit = m.unitId ? await txGet<Unit>(tx, ctx, C.units, m.unitId) : null;
      const deps = (await tx.get(col(ctx.companyId, C.deposits).where("contractId", "==", c.id))).docs.map((d) => d.data() as DepositEntryDoc).filter((d) => !d.archived);
      if (m.status === "completed") throw new ValidationError(["既に完了しています"]);
      const e: string[] = [];
      if (!m.confirmedDate) e.push("確認済み解約日が入力されていません");
      if (MO_KEYS.indexOf(m.status) < MO_KEYS.indexOf("vacated")) e.push("退去確認が済んでいません（状態を「退去確認済み」以降にしてください）");
      const b = depositBalance(deps);
      if (b.refundPending > 0) e.push(`返金予定 ${b.refundPending.toLocaleString()}円 が未実行です。返金実行を記録してから完了してください`);
      if (deps.some((d) => d.kind === "apply" && !d.approved)) e.push("未承認の敷金充当があります");
      if (e.length) throw new ValidationError(e);
      txUpdate(tx, ctx, C.moveouts, m, null, { status: "completed", completedAt: nowIso(), completedBy: ctx.uid });
      if (["executed", "active"].includes(c.status)) txUpdate(tx, ctx, C.contracts, c, null, { status: "ended", end: m.confirmedDate });
      if (unit && unit.currentContractId === c.id) txUpdate(tx, ctx, C.units, unit, null, { currentContractId: null, occupancy: "vacant", expectedVacancyDate: null });
      audit(tx, ctx, "moveout.complete", C.moveouts, m.id, { contractId: c.id, end: m.confirmedDate, previousEnd: c.end, unitReleased: unit?.currentContractId === c.id });
      return null;
    });
    return null;
  });
}
