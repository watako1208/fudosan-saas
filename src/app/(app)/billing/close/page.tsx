import Link from "next/link";
import { requireStaffPage } from "@/lib/server/session";
import { findDocs } from "@/lib/server/repo";
import { staffNameMap } from "@/lib/server/lookups";
import { lockState } from "@/lib/server/jobs/billing";
import { closePeriod, unlockPeriod, acknowledgeRecheck } from "@/lib/server/actions/periods";
import { C, Invoice, Settlement } from "@/lib/types";
import { PageHeader, Card, Badge, StateMessage } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { BillingNav } from "@/components/billing/BillingNav";
import { INVOICE_STATUS, SETTLEMENT_STATUS } from "@/lib/labels-billing";
import { lbl, tone } from "@/lib/labels";
import { addPeriod, isPeriodLocked } from "@/lib/domain/billing";
import { formatDateTimeJst, todayJst } from "@/lib/domain/dates";
import { yen } from "@/lib/domain/money";

export const metadata = { title: "月次締め" };

/** B25: 月次締め・締め解除（管理者）。解除後は影響する請求・精算の再確認を求める */
export default async function ClosePage() {
  const ctx = await requireStaffPage("settings.manage");
  const { closedThrough, locks } = await lockState(ctx);
  const names = await staffNameMap(ctx);
  const thisMonth = todayJst().slice(0, 7);
  const lockedSet = locks.filter((l) => l.locked).map((l) => l.period);
  const nextToClose = closedThrough ? addPeriod(closedThrough, 1) : addPeriod(thisMonth, -1);
  const canClose = nextToClose < thisMonth;
  const canUnlock = ctx.caps.has("period.unlock");
  // 最近24か月の状態
  const months = Array.from({ length: 24 }, (_, i) => addPeriod(thisMonth, -1 - i));
  const unlocked = locks.filter((l) => !l.locked && l.unlockedAt && !l.recheckedAt);
  const affected = await Promise.all(
    unlocked.map(async (l) => ({
      lock: l,
      invoices: await findDocs<Invoice>(ctx, C.invoices, [["period", "==", l.period]], 300),
      settlements: await findDocs<Settlement>(ctx, C.settlements, [["period", "==", l.period]], 300),
    })),
  );

  return (
    <>
      <PageHeader title="月次締め" sub="締めた月の請求・入金・精算は通常の編集・作成・確定ができなくなります。締め解除は会社管理者のみ・理由必須・再ログインが必要です。" />
      <BillingNav current="close" isAdmin />
      <Card title="締め">
        <p className="text-sm">
          現在の締め済み最終月: <b>{closedThrough ?? "未設定（まだ締めていません）"}</b>
        </p>
        {!closedThrough && <p className="help">初回の締めでは、指定した月以前がすべて締め済みになります。</p>}
        <div className="mt-3">
          {canClose ? (
            <ActionButton
              action={closePeriod}
              args={{ period: nextToClose }}
              label={`${nextToClose} を締める`}
              variant="primary"
              confirm={`${nextToClose} を締めます。締めた後は、この月の請求・入金・精算を変更できなくなります。よろしいですか？`}
            />
          ) : (
            <p className="text-sm text-muted">締められる月はありません（締めは前月以前を月順に行います）。</p>
          )}
        </div>
      </Card>

      {affected.length > 0 && (
        <div className="mt-4">
          <Card title="締め解除後の再確認">
            {affected.map(({ lock, invoices, settlements }) => (
              <div key={lock.period} className="mb-6 rounded-md border border-warn/40 bg-warn-soft p-3 last:mb-0">
                <p className="font-semibold text-warn">確認待ち: {lock.period} の締めが解除されています</p>
                <p className="text-sm">解除: {formatDateTimeJst(lock.unlockedAt)} {names.get(lock.unlockedBy ?? "") ?? ""} ／ 理由: {lock.unlockReason}</p>
                <p className="mt-2 text-sm">影響する請求（{invoices.length}件）と精算（{settlements.length}件）を確認し、必要な訂正を行ってから再度締めてください。</p>
                <div className="mt-2 grid gap-3 lg:grid-cols-2">
                  <table className="table bg-surface">
                    <thead><tr><th>請求</th><th>請求先</th><th className="num">金額</th><th>状態</th></tr></thead>
                    <tbody>
                      {invoices.length === 0 && <tr><td colSpan={4} className="text-muted">なし</td></tr>}
                      {invoices.map((i) => (
                        <tr key={i.id}>
                          <td><Link className="text-primary hover:underline" href={`/billing/invoices/${i.id}`}>{i.number}</Link></td>
                          <td>{i.billToName}</td>
                          <td className="num">{yen(i.total)}</td>
                          <td><Badge tone={tone(INVOICE_STATUS, i.status)}>{lbl(INVOICE_STATUS, i.status)}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <table className="table bg-surface">
                    <thead><tr><th>精算</th><th className="num">送金予定</th><th>状態</th></tr></thead>
                    <tbody>
                      {settlements.length === 0 && <tr><td colSpan={3} className="text-muted">なし</td></tr>}
                      {settlements.map((s) => (
                        <tr key={s.id}>
                          <td><Link className="text-primary hover:underline" href={`/settlements/${s.id}`}>{s.number}</Link></td>
                          <td className="num">{yen(s.calc?.payable ?? null)}</td>
                          <td><Badge tone={tone(SETTLEMENT_STATUS, s.status)}>{lbl(SETTLEMENT_STATUS, s.status)}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-2">
                  <ActionButton action={acknowledgeRecheck} args={{ period: lock.period }} label="再確認を完了した" confirm="影響する請求・精算の確認が完了したことを記録します。" />
                </div>
              </div>
            ))}
          </Card>
        </div>
      )}

      <div className="mt-4">
        <Card title="月ごとの締め状態（直近24か月）">
          {months.length === 0 ? (
            <StateMessage kind="empty" />
          ) : (
            <table className="table">
              <thead><tr><th>月</th><th>状態</th><th>履歴</th><th /></tr></thead>
              <tbody>
                {months.map((m) => {
                  const locked = isPeriodLocked(m, closedThrough, lockedSet);
                  const l = locks.find((x) => x.period === m);
                  return (
                    <tr key={m}>
                      <td>{m}</td>
                      <td>{locked ? <Badge tone="ok">締め済み</Badge> : l?.unlockedAt ? <Badge tone="warn">締め解除中</Badge> : <Badge>未締め</Badge>}</td>
                      <td className="text-sm">
                        {(l?.history ?? []).slice(-3).map((h, i) => (
                          <div key={i}>{formatDateTimeJst(h.at)} {h.byName}: {h.action === "close" ? "締め" : `締め解除（${h.reason ?? ""}）`}</div>
                        ))}
                      </td>
                      <td>
                        {locked && canUnlock && (
                          <ActionButton
                            action={unlockPeriod}
                            args={{ period: m }}
                            label="締め解除"
                            size="sm"
                            variant="danger"
                            prompt={`${m} の締めを解除する理由を入力してください`}
                            confirm={`${m} の締めを解除します。解除後は影響する請求・精算の再確認が必要です。`}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
