import Link from "next/link";
import { Card, Badge, StateMessage } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { approveDepositEntry, withdrawDepositEntry } from "@/lib/server/actions/deposits";
import { depositByHolder, DepositHolder } from "@/lib/domain/contracts";
import { yen } from "@/lib/domain/money";
import { lbl } from "@/lib/labels";
import { DEPOSIT_KIND, DEPOSIT_HOLDER_SHORT } from "@/lib/labels-contracts";
import type { DepositEntryDoc } from "@/lib/types";
import { DepositEntryForm } from "./DepositEntryForm";

type Entry = DepositEntryDoc & { attachmentId?: string | null };

/**
 * 敷金など預り金（B21/T12）: 受入・承認済み充当・既返金・追加請求を別々に表示し、保管主体ごとに残高を分ける。
 * 貸主保管の敷金は自社の現金残高に含めない。
 */
export function DepositPanel({
  contractId,
  moveoutId,
  entries,
  depositAmount,
  defaultHolder,
  canWrite,
  canApprove,
  attachments,
  today,
  names,
}: {
  contractId: string;
  moveoutId: string | null;
  entries: Entry[];
  depositAmount: number | null;
  defaultHolder: string | null;
  canWrite: boolean;
  canApprove: boolean;
  attachments: { value: string; label: string }[];
  today: string;
  names: Map<string, string>;
}) {
  const live = entries.filter((e) => !e.archived).sort((a, b) => (a.date === b.date ? (a.createdAt < b.createdAt ? -1 : 1) : a.date < b.date ? -1 : 1));
  const by = depositByHolder(live);
  const holders = (["company", "lessor", "other"] as DepositHolder[]).filter((h) => live.some((e) => e.holder === h) || h === defaultHolder);
  return (
    <div className="space-y-4">
      <Card title="預り残高（保管主体別）">
        <p className="mb-3 text-sm text-muted">
          契約上の敷金: {depositAmount === null ? "未入力" : yen(depositAmount)}。
          自社の現金として扱うのは「自社保管」の残高のみです。
        </p>
        {holders.length === 0 ? (
          <p className="text-muted">記録がありません</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr><th>保管主体</th><th className="num">受入</th><th className="num">承認済み充当</th><th className="num">返金実行</th><th className="num">預り残高</th><th className="num">返金予定（未実行）</th><th className="num">追加請求</th></tr>
              </thead>
              <tbody>
                {holders.map((h) => (
                  <tr key={h}>
                    <td><Badge tone={h === "company" ? "info" : "neutral"}>{lbl(DEPOSIT_HOLDER_SHORT, h)}</Badge></td>
                    <td className="num">{yen(by[h].received)}</td>
                    <td className="num">{yen(by[h].applied)}</td>
                    <td className="num">{yen(by[h].refunded)}</td>
                    <td className="num font-semibold">{yen(by[h].balance)}</td>
                    <td className="num">{by[h].refundPending > 0 ? <Badge tone="warn">{yen(by[h].refundPending)} 未実行</Badge> : yen(0)}</td>
                    <td className="num">{yen(by[h].additional)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="記録の明細">
        {live.length === 0 ? (
          <StateMessage kind="empty" message="預り金の記録はまだありません（締結記録時に契約の敷金額で受入を記録します）" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>日付</th><th>種類</th><th>保管主体</th><th className="num">金額</th><th>内容・理由</th><th>承認</th><th>記録者</th><th></th></tr></thead>
              <tbody>
                {live.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap">{e.date}</td>
                    <td>{lbl(DEPOSIT_KIND, e.kind)}</td>
                    <td>{lbl(DEPOSIT_HOLDER_SHORT, e.holder)}</td>
                    <td className="num">{yen(e.amount)}</td>
                    <td className="max-w-64 whitespace-pre-wrap">
                      {e.reason ?? "—"}
                      {e.attachmentId && <div><Link className="text-primary hover:underline" href={`/api/files/${e.attachmentId}`} target="_blank">資料を表示</Link></div>}
                      {e.moveoutId && !moveoutId && <div><Link className="text-primary hover:underline" href={`/lease/moveouts/${e.moveoutId}`}>退去精算</Link></div>}
                    </td>
                    <td>{e.kind === "apply" ? (e.approved ? <Badge tone="ok">承認済み</Badge> : <Badge tone="warn">承認待ち</Badge>) : "—"}</td>
                    <td>{names.get(e.createdBy) ?? (e.createdBy === "system" ? "定期処理" : "—")}</td>
                    <td className="whitespace-nowrap">
                      {e.kind === "apply" && !e.approved && (
                        <span className="flex flex-wrap gap-1">
                          {canApprove && <ActionButton size="sm" variant="primary" action={approveDepositEntry} args={{ id: e.id }} label="承認" confirm="この充当を承認します。預り残高から差し引かれます。" />}
                          {canWrite && <ActionButton size="sm" action={withdrawDepositEntry} args={{ id: e.id }} label="取下げ" prompt="取下げ理由を入力してください" />}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {canWrite && <DepositEntryForm contractId={contractId} moveoutId={moveoutId} defaultHolder={defaultHolder} attachments={attachments} today={today} />}
    </div>
  );
}
