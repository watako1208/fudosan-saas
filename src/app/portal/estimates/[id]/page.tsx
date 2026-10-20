import Link from "next/link";
import { requireExternalPage } from "@/lib/server/portal-access";
import { getDoc } from "@/lib/server/repo";
import { answerOwnerEstimate } from "@/lib/server/actions/portal";
import { C, Property, Unit } from "@/lib/types";
import { Card, DL, StateMessage } from "@/components/ui";
import { NoScope } from "@/components/portal/Guard";
import { MiniForm } from "@/components/support/MiniForm";
import { BURDEN_PARTY, lbl, estimateDiff, EstimateExt, RepairExt } from "@/lib/labels-support";
import { yen } from "@/lib/domain/money";
import { formatDateTimeJst } from "@/lib/domain/dates";

export const metadata = { title: "見積の確認" };

export default async function PortalEstimate({ params }: { params: Promise<{ id: string }> }) {
  const { ctx, scope } = await requireExternalPage();
  if (!scope) return <NoScope />;
  const { id } = await params;
  const e = scope.kind === "owner" && scope.estimateIds.has(id) ? await getDoc<EstimateExt>(ctx, C.estimates, id) : null;
  const r = e ? await getDoc<RepairExt>(ctx, C.repairs, e.repairId) : null;
  if (!e || !r || !r.propertyId || !scope.propertyIds.has(r.propertyId) || !e.ownerApprovalRequested || !(e.ownerPartyIds ?? []).includes(scope.partyId)) {
    return <div className="card"><StateMessage kind="forbidden" message="この見積は表示できません" /></div>;
  }
  const [p, u, prev] = await Promise.all([
    getDoc<Property>(ctx, C.properties, r.propertyId),
    r.unitId ? getDoc<Unit>(ctx, C.units, r.unitId) : null,
    e.previousId ? getDoc<EstimateExt>(ctx, C.estimates, e.previousId) : null,
  ]);
  const diff = e.previousId ? estimateDiff(prev, e) : null;
  return (
    <>
      <Link href="/portal/estimates" className="text-sm text-primary hover:underline">← 見積の承認</Link>
      <h1 className="mt-1 mb-4 break-words">{p?.name ?? "物件"}{u ? ` ${u.number}` : ""} の修繕見積（第{e.versionNo}版）</h1>
      <Card title="修繕内容">
        <DL items={[["対象設備", r.equipment], ["症状・内容", r.symptom], ["施工予定日", r.scheduledDate]]} />
      </Card>
      {diff && (
        <div className="mt-4 rounded-md border border-warn/30 bg-warn-soft p-3 text-sm">
          <p className="font-semibold text-warn">追加・変更版です</p>
          <p>変更理由: {e.reason ?? "—"}</p>
          <p>前回承認版 {yen(prev?.total ?? null)} → 今回 {yen(e.total)}（差額 {diff.totalDiff >= 0 ? "+" : ""}{diff.totalDiff.toLocaleString("ja-JP")}円）</p>
        </div>
      )}
      <Card title="見積明細" className="mt-4">
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>項目</th><th className="num">数量</th><th className="num">単価</th><th className="num">金額</th><th>費用負担</th></tr></thead>
            <tbody>
              {e.lines.map((l, i) => (
                <tr key={i}>
                  <td className="break-words">{l.name}</td>
                  <td className="num">{l.quantity}{l.unit}</td>
                  <td className="num">{Number(l.unitPrice).toLocaleString("ja-JP")}</td>
                  <td className="num">{yen(l.amount)}</td>
                  <td>{l.burden.map((b) => `${lbl(BURDEN_PARTY, b.party)} ${yen(b.amount)}`).join(" / ") || "—"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={3} className="text-right">小計（税抜）</td><td className="num">{yen(e.subtotal)}</td><td /></tr>
              <tr><td colSpan={3} className="text-right">消費税</td><td className="num">{yen(e.tax)}</td><td /></tr>
              <tr><td colSpan={3} className="text-right font-semibold">合計</td><td className="num font-semibold">{yen(e.total)}</td><td /></tr>
            </tfoot>
          </table>
        </div>
      </Card>
      <Card title="ご回答" className="mt-4">
        {e.status === "submitted" ? (
          <MiniForm action={answerOwnerEstimate} args={{ estimateId: e.id, versionNo: e.versionNo }} submitLabel="回答を送信" resetOnSuccess={false} confirm="この内容で回答しますか？">
            <fieldset className="space-y-2">
              <legend className="label">回答</legend>
              <label className="flex min-h-10 items-center gap-2"><input type="radio" name="answer" value="approve" defaultChecked /> 承認する</label>
              <label className="flex min-h-10 items-center gap-2"><input type="radio" name="answer" value="reject" /> 承認しない（コメントに理由をご記入ください）</label>
            </fieldset>
            <label className="mt-2 block">
              <span className="label">コメント</span>
              <textarea name="comment" rows={3} className="input" />
            </label>
            <p className="mt-3 rounded-md bg-bg p-3 text-sm">
              内容を確認し回答した記録であり、電子署名による契約締結ではありません。回答日時・ログイン時刻・対象の版（第{e.versionNo}版）を記録します。
            </p>
          </MiniForm>
        ) : e.externalApproval && e.externalApproval.partyId === scope.partyId ? (
          <div className="text-sm">
            <p>
              {formatDateTimeJst(e.externalApproval.at)} に第{e.externalApproval.versionNo}版へ「{e.externalApproval.answer === "approve" ? "承認する" : "承認しない"}」と回答しました。
            </p>
            {e.externalApproval.comment && <p className="mt-1">コメント: {e.externalApproval.comment}</p>}
            <p className="help mt-2">内容を確認し回答した記録であり、電子署名による契約締結ではありません。</p>
          </div>
        ) : (
          <p className="text-sm text-muted">この見積の回答受付は終了しました。</p>
        )}
      </Card>
    </>
  );
}
