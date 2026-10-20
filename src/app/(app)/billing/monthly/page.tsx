import Link from "next/link";
import { requireStaffPage } from "@/lib/server/session";
import { SP } from "@/lib/server/query";
import { generateMonthlyInvoices, findRecalcCandidates, isLocked, PlannedChargeSummary } from "@/lib/server/jobs/billing";
import { runMonthlyBilling, recalcInvoices } from "@/lib/server/actions/billing";
import { PageHeader, Card, Badge, StateMessage } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { BillingNav } from "@/components/billing/BillingNav";
import { addPeriod, isValidPeriod } from "@/lib/domain/billing";
import { todayJst } from "@/lib/domain/dates";
import { yen } from "@/lib/domain/money";

export const metadata = { title: "月次請求作成" };

/** B05/B06: 対象月を選び、作成予定（新規/作成済み）を確認してから作成する。再実行しても二重作成しない */
export default async function MonthlyBillingPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireStaffPage("billing.read");
  const sp = await searchParams;
  const thisMonth = todayJst().slice(0, 7);
  const period = typeof sp.period === "string" && isValidPeriod(sp.period) ? sp.period : addPeriod(thisMonth, 1);
  const canWrite = ctx.caps.has("billing.write");
  let preview: Awaited<ReturnType<typeof generateMonthlyInvoices>> | null = null;
  let error: string | null = null;
  try {
    preview = await generateMonthlyInvoices(ctx, period, { dryRun: true });
  } catch (e) {
    console.error("[monthly.preview]", (e as Error).message);
    error = "作成予定を計算できませんでした。時間をおいて再読み込みしてください。";
  }
  const locked = await isLocked(ctx, period);
  let candidates: Awaited<ReturnType<typeof findRecalcCandidates>> = [];
  let candError: string | null = null;
  try {
    candidates = await findRecalcCandidates(ctx);
  } catch (e) {
    console.error("[monthly.recalc]", (e as Error).message);
    candError = "再計算候補を読み込めませんでした。";
  }
  const byContract = new Map<string, PlannedChargeSummary[]>();
  for (const p of preview?.planned ?? []) byContract.set(p.contractId, [...(byContract.get(p.contractId) ?? []), p]);
  const newCount = preview?.planned.filter((p) => p.status === "new").length ?? 0;
  const periods = Array.from({ length: 8 }, (_, i) => addPeriod(thisMonth, 2 - i));

  return (
    <>
      <PageHeader title="月次請求作成" sub="締結記録済み・契約期間中の賃貸契約の確定済み契約版から、対象月の月額請求（下書き）を作成します。" />
      <BillingNav current="monthly" isAdmin={ctx.caps.has("settings.manage")} />
      <Card title="対象月">
        <form method="get" className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="label">対象月</span>
            <select name="period" className="input !w-auto" defaultValue={period}>
              {!periods.includes(period) && <option value={period}>{period}</option>}
              {periods.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn btn-secondary">作成予定を表示</button>
        </form>
        {locked && <p className="mt-3 text-sm font-semibold">{period} は月次締め済みのため、請求を作成できません。</p>}
      </Card>

      <div className="mt-4">
        <Card
          title={`${period} の作成予定`}
          actions={
            canWrite && !locked && preview && (
              <ActionButton
                action={runMonthlyBilling}
                args={{ period }}
                label={newCount ? `新規 ${newCount}明細を作成` : "作成（新規なし）"}
                variant="primary"
                disabled={!newCount}
                disabledReason={!newCount ? "新しく作成する明細はありません（作成済み）" : undefined}
                confirm={`${period} の月額請求を作成します。新規 ${newCount}明細。作成済みの明細は作成しません。`}
              />
            )
          }
        >
          {error ? (
            <StateMessage kind="error" message={error} />
          ) : !preview || preview.planned.length === 0 ? (
            <StateMessage kind="empty" message={`${period} に請求対象となる契約（締結記録済み・契約期間中で月額費用のある確定済み契約版）がありません`} />
          ) : (
            <>
              <p className="mb-3 text-sm">
                新規作成 <b>{newCount}</b> 明細 ／ 作成済み <b>{preview.existing}</b> 明細 ／ 契約 <b>{byContract.size}</b> 件。
                同じ契約・対象月・費目・請求種別の明細は二重に作成しません。
              </p>
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr><th>契約</th><th>請求先</th><th>費目</th><th>期間</th><th className="num">金額</th><th>計算式</th><th>作成状況</th></tr>
                  </thead>
                  <tbody>
                    {[...byContract.values()].flatMap((list) =>
                      list.map((p, i) => (
                        <tr key={p.dedupeKey}>
                          <td>{i === 0 ? <Link className="text-primary hover:underline" href={`/contracts/${p.contractId}`}>{p.contractNumber} {p.contractTitle}</Link> : ""}</td>
                          <td>{i === 0 ? p.billToName : ""}</td>
                          <td>{p.itemName}</td>
                          <td className="whitespace-nowrap">{p.from}〜{p.to}</td>
                          <td className="num">{yen(p.amount)}</td>
                          <td className="text-sm">{p.formula}</td>
                          <td>
                            {p.status === "new" ? (
                              <Badge tone="info">新規作成</Badge>
                            ) : (
                              <span>
                                <Badge>作成済み</Badge>
                                {p.invoiceId && <Link className="ml-1 text-sm text-primary hover:underline" href={`/billing/invoices/${p.invoiceId}`}>請求を表示</Link>}
                              </span>
                            )}
                          </td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {preview && preview.skipped.length > 0 && (
            <div className="mt-4 rounded-md border border-danger/30 bg-danger-soft p-3 text-sm" role="alert">
              <p className="font-semibold text-danger">作成できない契約があります（{preview.skipped.length}件）</p>
              <ul className="mt-1 list-disc pl-5">
                {preview.skipped.map((s) => (
                  <li key={s.contractId}><Link className="underline" href={`/contracts/${s.contractId}`}>{s.contractNumber}</Link>: {s.reason}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      <div className="mt-4">
        <Card
          title="再計算候補（契約変更の影響を受ける未確定の請求）"
          actions={
            canWrite && candidates.length > 0 && (
              <ActionButton
                action={recalcInvoices}
                args={{ ids: candidates.map((c) => c.invoice.id) }}
                label={`${candidates.length}件をすべて再計算`}
                confirm="下書きの月額請求を現在の契約版から作り直します。確定済みの請求は変更しません。"
              />
            )
          }
        >
          <p className="mb-3 text-sm text-muted">契約条件の変更（新しい契約版）後、下書きの月額請求だけを再計算の対象にします。確定済みの請求・締め済みの月は変更しません。</p>
          {candError ? (
            <StateMessage kind="error" message={candError} />
          ) : candidates.length === 0 ? (
            <StateMessage kind="empty" message="再計算が必要な下書き請求はありません" />
          ) : (
            <table className="table">
              <thead><tr><th>請求</th><th>対象月</th><th>請求先</th><th className="num">現在の金額</th><th>理由</th><th /></tr></thead>
              <tbody>
                {candidates.map((c) => (
                  <tr key={c.invoice.id}>
                    <td><Link className="text-primary hover:underline" href={`/billing/invoices/${c.invoice.id}`}>{c.invoice.number}</Link></td>
                    <td>{c.invoice.period}</td>
                    <td>{c.invoice.billToName}</td>
                    <td className="num">{yen(c.invoice.total)}</td>
                    <td className="text-sm"><ul className="list-disc pl-4">{c.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul></td>
                    <td>{canWrite && <ActionButton action={recalcInvoices} args={{ ids: [c.invoice.id] }} label="再計算" size="sm" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
