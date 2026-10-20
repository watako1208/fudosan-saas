import "server-only";
import { adminDb } from "../firebase-admin";
import { col, getMany, txCreate, audit, keywords, BaseDoc } from "../repo";
import { Ctx, systemCtx } from "../session";
import { notify } from "../notify";
import { C, Contract, ContractVersion, Renewal } from "@/lib/types";
import { addDays } from "@/lib/domain/dates";
import { isRenewalTarget, noticeDeadlineFromRule, renewalSourceKey } from "@/lib/domain/contracts";

// S21 更新対象の抽出。対象になっただけでは契約更新を確定しない（更新の確定は担当者が明示的に行う）。
// 抽出キー `${contractId}__${満了日}` をドキュメントIDにするため、再実行しても二重作成しない。

/** 定期処理用（/api/jobs から CRON_SECRET 確認後に呼ばれる）。操作記録の実行者は「定期処理」 */
export async function extractRenewals(companyId: string, today: string, horizonDays = 120): Promise<{ created: number; skipped: number }> {
  return extractRenewalsAs(systemCtx(companyId), today, horizonDays);
}

/** 画面の「対象を抽出」からも同じ処理を実行する（操作記録は実行した利用者） */
export async function extractRenewalsAs(ctx: Ctx, today: string, horizonDays = 120): Promise<{ created: number; skipped: number }> {
  const until = addDays(today, horizonDays);
  const snap = await col(ctx.companyId, C.contracts)
    .where("kind", "==", "lease")
    .where("status", "in", ["executed", "active"])
    .where("end", ">=", today)
    .where("end", "<=", until)
    .limit(2000)
    .get();
  const contracts = snap.docs
    .map((d) => ({ ...(d.data() as Contract), id: d.id }))
    .filter((c) => !c.archived && isRenewalTarget(c, today, horizonDays));
  const versions = await getMany<ContractVersion>(ctx, C.contractVersions, contracts.map((c) => c.currentVersionId ?? ""));

  let created = 0;
  let skipped = 0;
  for (const c of contracts) {
    const end = c.end!;
    const key = renewalSourceKey(c.id, end);
    const v = c.currentVersionId ? versions.get(c.currentVersionId) : undefined;
    // B24: 案内期限は契約版に保存したルールから計算する（会社設定の変更で過去契約の期限を変えない）
    const noticeDeadline = noticeDeadlineFromRule(end, v?.renewal?.noticeRule ?? null);
    const made = await adminDb().runTransaction(async (tx) => {
      const r = col(ctx.companyId, C.renewals).doc(key);
      if ((await tx.get(r)).exists) return false;
      txCreate(
        tx, ctx, C.renewals,
        {
          contractId: c.id,
          unitId: c.unitId,
          expiresOn: end,
          noticeDeadline,
          proposedTerms: null,
          answer: "pending",
          status: "extracted",
          newVersionId: null,
          invoiceId: null,
          sourceKey: key,
          // 一覧検索・表示用
          keywords: keywords(c.number, c.title),
          contractNumber: c.number,
          contractTitle: c.title,
          storeId: c.storeId,
          assigneeUid: c.assigneeUid,
        } satisfies Omit<Renewal, keyof BaseDoc> & Record<string, unknown>,
        key,
      );
      audit(tx, ctx, "renewal.extract", C.renewals, key, { contractId: c.id, expiresOn: end, noticeDeadline, rule: v?.renewal?.noticeRule ?? null });
      return true;
    });
    if (made) {
      created++;
      await notify(ctx, {
        toUid: c.assigneeUid,
        kind: "renewal",
        title: `更新対象: ${c.number} ${c.title}（満了 ${end}${noticeDeadline ? `・案内期限 ${noticeDeadline}` : ""}）`,
        href: `/lease/renewals/${key}`,
        dedupeKey: `renewal:${key}`,
      });
    } else skipped++;
  }
  return { created, skipped };
}
