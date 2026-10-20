import { requireStaffPage } from "@/lib/server/session";
import { listDocs } from "@/lib/server/repo";
import { C, JobRun } from "@/lib/types";
import { retryJobRun, runJobsNow } from "@/lib/server/actions/periods";
import { PageHeader, Card, Badge, StateMessage } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { BillingNav } from "@/components/billing/BillingNav";
import { JOB_STATUS, JOB_NAME } from "@/lib/labels-billing";
import { lbl, tone } from "@/lib/labels";
import { formatDateTimeJst } from "@/lib/domain/dates";

export const metadata = { title: "定期処理" };

/** 定期処理（月次請求・期限抽出・通知作成）の実行履歴。失敗した処理は再実行できる（成功済みは二重実行しない） */
export default async function JobsPage() {
  const ctx = await requireStaffPage("settings.manage");
  let runs: JobRun[] = [];
  let error: string | null = null;
  try {
    runs = (await listDocs<JobRun>(ctx, C.jobRuns, { orderBy: "startedAt", dir: "desc", pageSize: 100 })).items;
  } catch (e) {
    console.error("[jobs.list]", (e as Error).message);
    error = "実行履歴を読み込めませんでした。";
  }
  const succeededKeys = new Set(runs.filter((r) => r.status === "succeeded").map((r) => r.key));
  return (
    <>
      <PageHeader
        title="定期処理"
        sub="毎日、翌月分の月次請求（下書き）・更新対象の抽出・期限通知の作成を実行します。同じ処理キーで成功済みの処理は再実行しません。"
        actions={<ActionButton action={runJobsNow} label="今すぐ実行" confirm="本日分の定期処理を実行します（成功済みの処理は実行されません）。" />}
      />
      <BillingNav current="jobs" isAdmin />
      <Card title="実行履歴（直近100件）">
        {error ? (
          <StateMessage kind="error" message={error} />
        ) : runs.length === 0 ? (
          <StateMessage kind="empty" message="まだ実行されていません" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>処理</th><th>処理キー</th><th>状態</th><th>開始</th><th>終了</th><th>結果・エラー</th><th>再実行元</th><th /></tr></thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td>{lbl(JOB_NAME, r.job)}</td>
                    <td className="text-sm">{r.key}</td>
                    <td><Badge tone={tone(JOB_STATUS, r.status)}>{lbl(JOB_STATUS, r.status)}</Badge></td>
                    <td className="whitespace-nowrap">{formatDateTimeJst(r.startedAt)}</td>
                    <td className="whitespace-nowrap">{formatDateTimeJst(r.finishedAt)}</td>
                    <td className="text-sm">
                      {r.error ? <span className="text-danger">{r.error}</span> : r.result ? Object.entries(r.result).map(([k, v]) => `${k}: ${String(v)}`).join("、") : "—"}
                    </td>
                    <td className="text-xs text-muted">{r.retryOf ?? "—"}</td>
                    <td>
                      {r.status === "failed" && !succeededKeys.has(r.key) && (
                        <ActionButton action={retryJobRun} args={{ id: r.id }} label="再実行" size="sm" confirm="この処理を同じ処理キーで再実行します。" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
