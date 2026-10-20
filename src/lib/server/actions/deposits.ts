"use server";
import { adminDb } from "../firebase-admin";
import { requireStaff, AuthError } from "../session";
import { run, str, optStr, optYen, ActionResult } from "../action";
import { ValidationError, txGet, txCreate, txUpdate, audit, runOnce, col, BaseDoc } from "../repo";
import { C, Contract, DepositEntryDoc, Attachment, Moveout } from "@/lib/types";
import { isValidBizDate } from "@/lib/domain/dates";
import { depositEntryErrors, HolderEntry } from "@/lib/domain/contracts";

// 敷金など預り金（B21 / T12）。家賃収入とは区別し、保管主体（自社・貸主・その他）をエントリごとに保存する。
// 金銭記録のため削除はしない。充当は承認が必要。返金予定は残高を減らさず、返金実行で減らす。

const KINDS: DepositEntryDoc["kind"][] = ["receive", "apply", "refund_planned", "refund_executed", "additional_charge"];
const HOLDERS: DepositEntryDoc["holder"][] = ["company", "lessor", "other"];

async function requireDepositWriter() {
  const ctx = await requireStaff();
  if (!ctx.caps.has("lease.write") && !ctx.caps.has("contract.write")) throw new AuthError("この操作を行う権限がありません");
  return ctx;
}

export async function addDepositEntry(contractId: string, v: Record<string, unknown>): Promise<ActionResult<{ redirect: string }>> {
  return run(async () => {
    const ctx = await requireDepositWriter();
    const fe: Record<string, string> = {};
    const kind = str(v.kind) as DepositEntryDoc["kind"];
    if (!KINDS.includes(kind)) fe.kind = "種類を選択してください";
    const holder = str(v.holder) as DepositEntryDoc["holder"];
    if (!HOLDERS.includes(holder)) fe.holder = "保管主体を選択してください";
    const amount = optYen(v.amount, "amount", fe);
    if (amount === null && !fe.amount) fe.amount = "金額を入力してください";
    const date = str(v.date);
    if (!isValidBizDate(date)) fe.date = "日付を入力してください";
    const reason = optStr(v.reason);
    if ((kind === "apply" || kind === "additional_charge") && !reason) fe.reason = "充当・追加請求の内容（原状回復の内訳など）を入力してください";
    const attachmentId = optStr(v.attachmentId);
    const moveoutId = optStr(v.moveoutId);
    if (Object.keys(fe).length) throw new ValidationError(Object.values(fe), fe);

    await runOnce(ctx, str(v._requestId), async (tx) => {
      const c = await txGet<Contract>(tx, ctx, C.contracts, contractId);
      const existing = (await tx.get(col(ctx.companyId, C.deposits).where("contractId", "==", c.id))).docs
        .map((d) => d.data() as DepositEntryDoc)
        .filter((d) => !d.archived);
      const att = attachmentId ? await txGet<Attachment>(tx, ctx, C.attachments, attachmentId) : null;
      const mo = moveoutId ? await txGet<Moveout>(tx, ctx, C.moveouts, moveoutId) : null;
      if (mo && mo.contractId !== c.id) throw new ValidationError(["解約・退去の対象契約が一致しません"]);
      if (att && !att.linkKeys.includes(`contract:${c.id}`) && !(mo && att.linkKeys.includes(`moveout:${mo.id}`))) {
        throw new ValidationError(["選択した資料はこの契約・退去に登録されていません"]);
      }
      const e = depositEntryErrors(existing as HolderEntry[], { kind, amount: amount!, holder });
      if (e.length) throw new ValidationError(e, { amount: e[0] });
      const id = txCreate(tx, ctx, C.deposits, {
        contractId: c.id,
        kind,
        amount: amount!,
        date,
        holder,
        approved: kind !== "apply", // 充当は承認が必要
        approvedBy: kind !== "apply" ? ctx.uid : null,
        reason,
        moveoutId: mo?.id ?? null,
        attachmentId: att?.id ?? null,
      } satisfies Omit<DepositEntryDoc, keyof BaseDoc> & { attachmentId: string | null });
      audit(tx, ctx, `deposit.${kind}`, C.deposits, id, { contractId: c.id, amount, holder, date, moveoutId });
      return id;
    });
    return { redirect: moveoutId ? `/lease/moveouts/${moveoutId}?tab=deposit` : `/contracts/${contractId}?tab=deposit` };
  });
}

/** 充当の承認（契約承認または請求確定の権限） */
export async function approveDepositEntry(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff();
    if (!ctx.caps.has("contract.approve") && !ctx.caps.has("billing.confirm")) throw new AuthError("充当を承認する権限がありません");
    await adminDb().runTransaction(async (tx) => {
      const d = await txGet<DepositEntryDoc>(tx, ctx, C.deposits, str(input.id));
      if (d.kind !== "apply" || d.approved) throw new ValidationError(["未承認の充当のみ承認できます"]);
      txUpdate(tx, ctx, C.deposits, d, null, { approved: true, approvedBy: ctx.uid, approvedAt: new Date().toISOString() });
      audit(tx, ctx, "deposit.approve", C.deposits, d.id, { contractId: d.contractId, amount: d.amount });
    });
    return null;
  });
}

/** 未承認の充当を取り下げる（承認済み・受入・返金の記録は取り消さない） */
export async function withdrawDepositEntry(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireDepositWriter();
    const reason = optStr(input.reason);
    if (!reason) throw new ValidationError(["取下げ理由を入力してください"]);
    await adminDb().runTransaction(async (tx) => {
      const d = await txGet<DepositEntryDoc>(tx, ctx, C.deposits, str(input.id));
      if (d.kind !== "apply" || d.approved) throw new ValidationError(["未承認の充当のみ取り下げられます"]);
      txUpdate(tx, ctx, C.deposits, d, null, { archived: true, withdrawReason: reason });
      audit(tx, ctx, "deposit.withdraw", C.deposits, d.id, { reason });
    });
    return null;
  });
}
