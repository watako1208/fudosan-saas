"use server";
import { adminDb } from "../firebase-admin";
import { requireStaff, requireRecentAuth } from "../session";
import { run, str, ActionResult } from "../action";
import { ValidationError, col, audit, nowIso, getDoc } from "../repo";
import { C, JobRun } from "@/lib/types";
import { addPeriod, isValidPeriod } from "@/lib/domain/billing";
import { todayJst } from "@/lib/domain/dates";
import { companyRef, PeriodLockDoc } from "../jobs/billing";
import { runKeyedJob, runDailyJobs } from "../jobs/runner";

// B25: 月次締め。締めは前月以前を順番に行う（初回は指定月以前がすべて締め済みになる）。
// 締め状態 = companies/{id}.settings.closedThrough 以前、または periodLocks/{YYYY-MM}.locked。
// 締め解除は理由必須・再認証・period.unlock 権限。解除した月だけを開け、後続の月は締めたまま残す。

export async function closePeriod(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff("settings.manage");
    const period = str(input.period);
    if (!isValidPeriod(period)) throw new ValidationError(["締める月を選択してください"]);
    if (period >= todayJst().slice(0, 7)) throw new ValidationError(["締めができるのは前月以前です"]);
    await adminDb().runTransaction(async (tx) => {
      const locksSnap = await tx.get(col(ctx.companyId, C.periodLocks).limit(500));
      const company = await tx.get(companyRef(ctx));
      const closedThrough = (company.data()?.settings?.closedThrough as string | null) ?? null;
      const locks = new Map(locksSnap.docs.map((d) => [d.id, d.data() as PeriodLockDoc]));
      const cur = locks.get(period);
      const lockedNow = (closedThrough && period <= closedThrough) || cur?.locked;
      if (lockedNow) throw new ValidationError([`${period} は既に締め済みです`]);
      if (closedThrough && period !== addPeriod(closedThrough, 1)) {
        throw new ValidationError([`締めは月順に行います。次に締められるのは ${addPeriod(closedThrough, 1)} です`]);
      }
      const at = nowIso();
      const entry = { action: "close" as const, by: ctx.uid, byName: ctx.user.displayName, at, reason: null };
      tx.set(col(ctx.companyId, C.periodLocks).doc(period), {
        id: period,
        companyId: ctx.companyId,
        period,
        locked: true,
        closedAt: at,
        closedBy: ctx.uid,
        unlockedAt: cur?.unlockedAt ?? null,
        unlockedBy: cur?.unlockedBy ?? null,
        unlockReason: cur?.unlockReason ?? null,
        recheckedAt: null,
        history: [...(cur?.history ?? []), entry],
        updatedAt: at,
        createdAt: cur ? (cur as unknown as { createdAt?: string }).createdAt ?? at : at,
      });
      // 締め済みの連続する最終月まで closedThrough を進める
      let ct = period;
      while (locks.get(addPeriod(ct, 1))?.locked) ct = addPeriod(ct, 1);
      tx.update(companyRef(ctx), { "settings.closedThrough": ct });
      audit(tx, ctx, "period.close", C.periodLocks, period, { closedThrough: ct, previous: closedThrough });
    });
    return null;
  });
}

export async function unlockPeriod(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff("period.unlock");
    requireRecentAuth(ctx);
    const period = str(input.period);
    const reason = str(input.reason);
    if (!isValidPeriod(period)) throw new ValidationError(["締め解除する月が正しくありません"]);
    if (!reason) throw new ValidationError(["締め解除の理由を入力してください"]);
    await adminDb().runTransaction(async (tx) => {
      const locksSnap = await tx.get(col(ctx.companyId, C.periodLocks).limit(500));
      const company = await tx.get(companyRef(ctx));
      const closedThrough = (company.data()?.settings?.closedThrough as string | null) ?? null;
      const locks = new Map(locksSnap.docs.map((d) => [d.id, d.data() as PeriodLockDoc]));
      const cur = locks.get(period);
      const lockedNow = (closedThrough && period <= closedThrough) || cur?.locked;
      if (!lockedNow) throw new ValidationError([`${period} は締められていません`]);
      const at = nowIso();
      const lockRef = (p: string) => col(ctx.companyId, C.periodLocks).doc(p);
      if (closedThrough && period <= closedThrough) {
        // 後続の締め済み月は個別の締めレコードで締めたまま残す
        for (let p = addPeriod(period, 1); p <= closedThrough; p = addPeriod(p, 1)) {
          const l = locks.get(p);
          if (!l?.locked) {
            tx.set(lockRef(p), {
              id: p, companyId: ctx.companyId, period: p, locked: true, closedAt: l?.closedAt ?? at, closedBy: l?.closedBy ?? ctx.uid,
              unlockedAt: l?.unlockedAt ?? null, unlockedBy: l?.unlockedBy ?? null, unlockReason: l?.unlockReason ?? null,
              history: l?.history ?? [], updatedAt: at, createdAt: at,
            });
          }
        }
        tx.update(companyRef(ctx), { "settings.closedThrough": addPeriod(period, -1) <= "1970-01" ? null : addPeriod(period, -1) });
      }
      tx.set(lockRef(period), {
        id: period,
        companyId: ctx.companyId,
        period,
        locked: false,
        closedAt: cur?.closedAt ?? null,
        closedBy: cur?.closedBy ?? null,
        unlockedAt: at,
        unlockedBy: ctx.uid,
        unlockReason: reason,
        recheckedAt: null,
        recheckedBy: null,
        history: [...(cur?.history ?? []), { action: "unlock", by: ctx.uid, byName: ctx.user.displayName, at, reason }],
        updatedAt: at,
        createdAt: at,
      });
      audit(tx, ctx, "period.unlock", C.periodLocks, period, { reason, previousClosedThrough: closedThrough });
    });
    return null;
  });
}

/** 締め解除後に、影響する請求・精算を再確認したことを記録する */
export async function acknowledgeRecheck(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff("settings.manage");
    const period = str(input.period);
    const lock = await getDoc<PeriodLockDoc & { version: number; createdAt: string; createdBy: string; updatedBy: string }>(ctx, C.periodLocks, period);
    if (!lock) throw new ValidationError(["締めレコードが見つかりません"]);
    await adminDb().runTransaction(async (tx) => {
      tx.update(col(ctx.companyId, C.periodLocks).doc(period), { recheckedAt: nowIso(), recheckedBy: ctx.uid, updatedAt: nowIso() });
      audit(tx, ctx, "period.recheck", C.periodLocks, period, {});
    });
    return null;
  });
}

// ───────────── 定期処理 ─────────────

/** 失敗した定期処理を同じキーで再実行する（成功済みのキーは再実行しない） */
export async function retryJobRun(input: Record<string, unknown>): Promise<ActionResult<{ status: string; reason?: string }>> {
  return run(async () => {
    const ctx = await requireStaff("settings.manage");
    const r = await getDoc<JobRun>(ctx, C.jobRuns, str(input.id));
    if (!r) throw new ValidationError(["実行記録が見つかりません"]);
    if (r.status !== "failed") throw new ValidationError(["再実行できるのは失敗した処理だけです"]);
    const res = await runKeyedJob(ctx.companyId, r.job, r.key);
    if (res.status === "failed") throw new ValidationError([`再実行に失敗しました: ${res.reason ?? ""}`]);
    return { status: res.status, reason: res.reason };
  });
}

/** 自社分の定期処理を今すぐ実行（成功済みの処理は再実行されない） */
export async function runJobsNow(): Promise<ActionResult<Record<string, string>>> {
  return run(async () => {
    const ctx = await requireStaff("settings.manage");
    const r = await runDailyJobs(ctx.companyId);
    return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.status]));
  });
}
