import "server-only";
import { adminDb } from "../firebase-admin";
import { col, nowIso, baseFields, ValidationError } from "../repo";
import { systemCtx } from "../session";
import { C, JobRun } from "@/lib/types";
import { addPeriod } from "@/lib/domain/billing";
import { todayJst } from "@/lib/domain/dates";
import { generateMonthlyInvoices } from "./billing";
import { extractRenewals } from "./renewals";
import { createDeadlineNotifications } from "./reminders";

// 定期処理の実行基盤。実行ごとに JobRun を記録し（実行中/成功/失敗）、同じキーで成功済みの処理は再実行しない。
// 失敗した処理は同じキーで再実行でき、retryOf に前回の失敗記録を残す。

export type JobName = JobRun["job"];

const STALE_MS = 30 * 60 * 1000; // 実行中のまま30分経過した記録は中断とみなす

/** ログ・記録に個人情報を残さないよう、エラー内容を要約する */
export function safeErrorMessage(e: unknown): string {
  if (e instanceof ValidationError) return e.errors.join(" / ").slice(0, 300);
  const msg = e instanceof Error ? e.message : String(e);
  return (
    msg
      .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[メール]")
      .replace(/\d{2,4}-\d{2,4}-\d{3,4}/g, "[電話]")
      .slice(0, 300) || "処理中にエラーが発生しました"
  );
}

export async function runJob(
  companyId: string,
  job: JobName,
  key: string,
  fn: () => Promise<Record<string, unknown>>,
): Promise<{ status: "succeeded" | "failed" | "skipped"; runId: string | null; reason?: string; result?: Record<string, unknown> }> {
  const runs = col(companyId, C.jobRuns);
  const started = await adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(runs.where("key", "==", key).limit(100));
    const list = snap.docs.map((d) => d.data() as JobRun);
    if (list.some((r) => r.status === "succeeded")) return { skip: "成功済みのため実行しません" as string, id: null };
    if (list.some((r) => r.status === "running" && Date.now() - Date.parse(r.startedAt) < STALE_MS)) return { skip: "実行中のため実行しません", id: null };
    const lastFailed = list.filter((r) => r.status !== "succeeded").sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
    const r = runs.doc();
    const ctx = systemCtx(companyId);
    tx.create(r, {
      ...baseFields(ctx),
      id: r.id,
      job,
      key,
      status: "running",
      startedAt: nowIso(),
      finishedAt: null,
      result: null,
      error: null,
      retryOf: lastFailed?.id ?? null,
    } satisfies Omit<JobRun, never>);
    return { skip: null, id: r.id };
  });
  if (started.skip) return { status: "skipped", runId: null, reason: started.skip };
  const runId = started.id!;
  try {
    const result = await fn();
    await runs.doc(runId).update({ status: "succeeded", finishedAt: nowIso(), updatedAt: nowIso(), result: sanitizeResult(result) });
    return { status: "succeeded", runId, result };
  } catch (e) {
    const error = safeErrorMessage(e);
    console.error("[job-failed]", job, key, error);
    await runs.doc(runId).update({ status: "failed", finishedAt: nowIso(), updatedAt: nowIso(), error });
    return { status: "failed", runId, reason: error };
  }
}

/** 結果は件数などの集計値だけを保存する */
function sanitizeResult(r: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) if (typeof v === "number" || typeof v === "boolean" || (typeof v === "string" && v.length < 100)) out[k] = v;
  return out;
}

/** キーから処理を組み立てて実行する（定期実行・失敗時の再実行で共通） */
export async function runKeyedJob(companyId: string, job: JobName, key: string) {
  const ctx = systemCtx(companyId);
  const arg = key.split(":")[1] ?? "";
  switch (job) {
    case "monthly_billing":
      return runJob(companyId, job, key, async () => {
        const r = await generateMonthlyInvoices(ctx, arg);
        return { period: arg, created: r.created, existing: r.existing, invoices: r.invoiceIds.length, skipped: r.skipped.length };
      });
    case "deadline_extract":
      return runJob(companyId, job, key, async () => ({ ...(await extractRenewals(companyId, arg)) }));
    case "notifications":
      return runJob(companyId, job, key, async () => ({ ...(await createDeadlineNotifications(companyId, arg)) }));
    default:
      throw new ValidationError(["不明な処理です"]);
  }
}

/** 1社分の定期処理: 翌月分の月次請求・更新対象の抽出・期限通知 */
export async function runDailyJobs(companyId: string, today = todayJst()) {
  const next = addPeriod(today.slice(0, 7), 1);
  return {
    monthly_billing: await runKeyedJob(companyId, "monthly_billing", `monthly_billing:${next}`),
    deadline_extract: await runKeyedJob(companyId, "deadline_extract", `deadline_extract:${today}`),
    notifications: await runKeyedJob(companyId, "notifications", `notifications:${today}`),
  };
}
