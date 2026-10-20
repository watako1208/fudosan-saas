import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { requireStaffPage, canAccessStore } from "@/lib/server/session";
import { getDoc, findDocs } from "@/lib/server/repo";
import { tabOf, SP } from "@/lib/server/query";
import { staffName, staffNameMap, companySettings } from "@/lib/server/lookups";
import { listAttachments } from "@/lib/server/attachments";
import {
  setRepairStatus, recordCompletionCheck, updateRepairBilling, saveEstimateDraft, submitEstimate, approveEstimate,
  rejectEstimate, requestOwnerApproval, createEstimateRevision,
} from "@/lib/server/actions/repairs";
import { C, Property, Unit, Party, Inquiry, Activity } from "@/lib/types";
import { DetailHeader, Tabs, Card, DL, Badge, StateMessage } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { FileManager } from "@/components/FileManager";
import { MiniForm } from "@/components/support/MiniForm";
import { EstimateEditor } from "@/components/support/EstimateEditor";
import { Timeline } from "@/components/support/SupportNav";
import { ActivityForm } from "@/components/support/ActivityForm";
import {
  REPAIR_STATUS, ESTIMATE_STATUS, BURDEN_PARTY, REPAIR_BILLING, REPAIR_PAYMENT, ACTIVITY_CHANNEL, ACTIVITY_DIRECTION,
  REPAIR_PHOTO_CATEGORIES, nextRepairStatuses, estimateDiff, lbl, tone, opts, RepairExt, EstimateExt,
} from "@/lib/labels-support";
import { formatDateTimeJst } from "@/lib/domain/dates";
import { yen } from "@/lib/domain/money";

const TABS = ["overview", "estimate", "photos", "approvals", "billing"];

export default async function RepairDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const ctx = await requireStaffPage("repair.read");
  const { id } = await params;
  const sp = await searchParams;
  const r = await getDoc<RepairExt>(ctx, C.repairs, id);
  if (!r) notFound();
  if (!canAccessStore(ctx, r.storeId)) return <div className="card"><StateMessage kind="forbidden" message="この店舗の修繕案件を閲覧する権限がありません" /></div>;
  const tab = tabOf(sp, TABS, "overview");
  const canWrite = ctx.caps.has("repair.write");
  const canApprove = ctx.caps.has("repair.approve");
  const [property, unit, vendor, inquiry, estimates, names] = await Promise.all([
    r.propertyId ? getDoc<Property>(ctx, C.properties, r.propertyId) : null,
    r.unitId ? getDoc<Unit>(ctx, C.units, r.unitId) : null,
    r.vendorPartyId && ctx.caps.has("party.read") ? getDoc<Party>(ctx, C.parties, r.vendorPartyId) : null,
    r.inquiryId ? getDoc<Inquiry>(ctx, C.inquiries, r.inquiryId) : null,
    findDocs<EstimateExt>(ctx, C.estimates, [["repairId", "==", id]], 200),
    staffNameMap(ctx),
  ]);
  estimates.sort((a, b) => b.versionNo - a.versionNo);
  const current = estimates.find((e) => e.id === r.currentEstimateId) ?? null;
  const base = `/support/repairs/${id}`;
  const approvedWaitingOrder = r.status === "awaiting_approval" && r.approvalState === "approved";
  const next = nextRepairStatuses(r.status).filter((s) => s !== "awaiting_approval");

  return (
    <>
      <DetailHeader
        back={{ href: "/support/repairs", label: "修繕案件一覧" }}
        number={r.number}
        title={`${property?.name ?? "（物件未設定）"}${unit ? ` ${unit.number}` : ""} ／ ${r.equipment ?? r.symptom.slice(0, 30)}`}
        badges={
          <>
            <Badge tone={approvedWaitingOrder ? "info" : tone(REPAIR_STATUS, r.status)}>{approvedWaitingOrder ? "承認済み・発注記録待ち" : lbl(REPAIR_STATUS, r.status)}</Badge>
            <Badge tone={tone(REPAIR_BILLING, r.billingStatus)}>請求: {lbl(REPAIR_BILLING, r.billingStatus)}</Badge>
            <Badge tone={tone(REPAIR_PAYMENT, r.paymentStatus)}>支払: {lbl(REPAIR_PAYMENT, r.paymentStatus)}</Badge>
          </>
        }
        meta={
          <>
            <span>担当: {await staffName(ctx, r.assigneeUid)}</span>
            <span>業者: {vendor?.name ?? (r.vendorPartyId ? "（登録あり）" : "未設定")}</span>
            <span>施工予定: {r.scheduledDate ?? "未定"}</span>
            {current && <span>現行見積: 第{current.versionNo}版 {yen(current.total)}（{lbl(ESTIMATE_STATUS, current.status)}）</span>}
          </>
        }
        actions={
          canWrite && (
            <>
              <Link href={`${base}/edit`} className="btn btn-secondary">編集</Link>
              {approvedWaitingOrder && <ActionButton action={setRepairStatus} args={{ id, status: "ordered" }} label="発注を記録" variant="primary" confirm="承認済み見積に基づき、発注を記録しますか？（発注そのものは外部で行います）" />}
              {r.status === "awaiting_completion_check" && (
                <ActionButton action={recordCompletionCheck} args={{ id }} label="完了確認を記録" variant="primary" prompt="確認内容（任意）" promptRequired={false} />
              )}
            </>
          )
        }
      />
      <Tabs
        base={base}
        current={tab}
        tabs={[
          { key: "overview", label: "概要" },
          { key: "estimate", label: "見積", count: estimates.length },
          { key: "photos", label: "写真" },
          { key: "approvals", label: "承認履歴" },
          { key: "billing", label: "請求・支払" },
        ]}
      />

      {tab === "overview" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <Card title="修繕内容">
              <DL
                items={[
                  ["物件", property ? <Link href={`/properties/${property.id}`} className="text-primary hover:underline">{property.name}</Link> : null],
                  ["部屋", unit?.number ?? null],
                  ["所在地", property?.address ?? null],
                  ["対象設備", r.equipment],
                  ["症状・依頼内容", <span key="s" className="whitespace-pre-wrap">{r.symptom}</span>],
                  ["依頼先業者", vendor ? `${vendor.name}${vendor.phone ? `（${vendor.phone}）` : ""}` : null],
                  ["元の問い合わせ", inquiry ? <Link href={`/support/${inquiry.id}`} className="text-primary hover:underline">{inquiry.number}（{inquiry.partyName ?? ""}）</Link> : null],
                  ["施工予定日", r.scheduledDate],
                  ["発注記録", r.orderedAt ? `${formatDateTimeJst(r.orderedAt)}（${names.get(r.orderedBy ?? "") ?? "—"}）` : null],
                  ["完了確認", r.completionCheckedBy ? `${formatDateTimeJst(r.completedAt)} ${names.get(r.completionCheckedBy) ?? ""}${r.completedNote ? `：${r.completedNote}` : ""}` : null],
                  ["中止理由", r.status === "cancelled" ? r.cancelReason ?? null : undefined],
                ].filter(([, v]) => v !== undefined) as [string, ReactNode][]}
              />
            </Card>
            {canWrite && next.length > 0 && (
              <Card title="状態を変更">
                <MiniForm action={setRepairStatus} args={{ id }} submitLabel="状態を変更" successMessage="変更しました">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="label">変更先</span>
                      <select name="status" className="input">
                        {next.map((s) => <option key={s} value={s}>{lbl(REPAIR_STATUS, s)}</option>)}
                      </select>
                    </label>
                    <label className="block">
                      <span className="label">理由・メモ（中止時は必須）</span>
                      <input name="reason" className="input" />
                    </label>
                  </div>
                  <p className="help">「承認待ち」は見積の承認申請で、「完了」は完了確認の記録でのみ設定します。発注記録には承認済みの現行見積が必要です。</p>
                </MiniForm>
              </Card>
            )}
          </div>
          <div className="space-y-4">
            <RepairActivities ctx={ctx} id={id} names={names} />
            {canWrite && (
              <Card title="対応記録を追記">
                <ActivityForm entity="repair" entityId={id} />
              </Card>
            )}
          </div>
        </div>
      )}

      {tab === "estimate" && (
        <EstimateTab
          repairId={id}
          estimates={estimates}
          current={current}
          canWrite={canWrite}
          canApprove={canApprove}
          settings={await companySettings(ctx.companyId)}
          names={names}
        />
      )}

      {tab === "photos" && (
        <FileManager
          entity="repair"
          entityId={id}
          canWrite={canWrite}
          categories={REPAIR_PHOTO_CATEGORIES}
          items={(await listAttachments(ctx, "repair", id)).map(({ id, fileName, contentType, category, description, visibility, takenAt, sort, size, sensitive }) => ({ id, fileName, contentType, category, description, visibility, takenAt, sort, size, sensitive }))}
        />
      )}

      {tab === "approvals" && <ApprovalsTab estimates={estimates} />}

      {tab === "billing" && (
        <Card title="請求・支払（修繕の進行状態とは別に管理）">
          {canWrite ? (
            <MiniForm action={updateRepairBilling.bind(null, id)} args={{ _version: r.version }} submitLabel="保存" resetOnSuccess={false}>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <label className="block">
                  <span className="label">請求状況（入居者・貸主など）</span>
                  <select name="billingStatus" className="input" defaultValue={r.billingStatus}>
                    {opts(REPAIR_BILLING).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="label">業者への支払状況</span>
                  <select name="paymentStatus" className="input" defaultValue={r.paymentStatus}>
                    {opts(REPAIR_PAYMENT).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="label">業者請求額（円）</span>
                  <input name="vendorBillAmount" className="input" inputMode="numeric" defaultValue={r.vendorBillAmount ?? ""} />
                </label>
                <label className="block">
                  <span className="label">業者への支払日</span>
                  <input name="vendorPaidOn" type="date" className="input" defaultValue={r.vendorPaidOn ?? ""} />
                </label>
                <label className="block">
                  <span className="label">関連する請求ID（請求・入金で作成した請求）</span>
                  <input name="invoiceId" className="input" defaultValue={r.invoiceId ?? ""} />
                </label>
                <label className="block sm:col-span-2 lg:col-span-3">
                  <span className="label">メモ</span>
                  <textarea name="billingNote" rows={2} className="input" defaultValue={r.billingNote ?? ""} />
                </label>
              </div>
              <p className="help">請求書の作成は「請求・入金」で行います。送金・振込は外部で実施し、結果をここに記録します。</p>
            </MiniForm>
          ) : (
            <DL items={[["請求状況", lbl(REPAIR_BILLING, r.billingStatus)], ["支払状況", lbl(REPAIR_PAYMENT, r.paymentStatus)], ["業者請求額", r.vendorBillAmount != null ? yen(r.vendorBillAmount) : null], ["支払日", r.vendorPaidOn ?? null]]} />
          )}
          {r.invoiceId && ctx.caps.has("billing.read") && (
            <p className="mt-3 text-sm"><Link href={`/billing/${r.invoiceId}`} className="text-primary hover:underline">関連する請求を開く</Link></p>
          )}
        </Card>
      )}
    </>
  );
}

async function RepairActivities({ ctx, id, names }: { ctx: Awaited<ReturnType<typeof requireStaffPage>>; id: string; names: Map<string, string> }) {
  const acts = await findDocs<Activity>(ctx, C.activities, [["entity", "==", "repair"], ["entityId", "==", id]], 500);
  acts.sort((a, b) => a.at.localeCompare(b.at));
  return (
    <Card title="対応記録（時系列）">
      <Timeline
        items={acts.map((a) => ({
          id: a.id, at: formatDateTimeJst(a.at), channel: lbl(ACTIVITY_CHANNEL, a.channel), direction: lbl(ACTIVITY_DIRECTION, a.direction),
          summary: a.summary, body: a.body, by: names.get(a.byUid) ?? "（不明）",
        }))}
      />
    </Card>
  );
}

function EstimateLinesTable({ e, showBurden = true }: { e: EstimateExt; showBurden?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>#</th><th>項目名</th><th className="num">数量</th><th>単位</th><th className="num">単価</th><th>税</th><th className="num">金額</th>
            {showBurden && <th>費用負担</th>}
          </tr>
        </thead>
        <tbody>
          {e.lines.map((l, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td className="break-words">{l.name}</td>
              <td className="num">{l.quantity}</td>
              <td>{l.unit}</td>
              <td className="num">{Number(l.unitPrice).toLocaleString("ja-JP")}</td>
              <td>{l.tax.category === "taxable" ? `課税${Math.round(Number(l.tax.rate) * 100)}%${l.tax.priceMode === "inclusive" ? "（税込）" : ""}` : l.tax.category === "exempt" ? "非課税" : "不課税"}</td>
              <td className="num">{yen(l.amount)}</td>
              {showBurden && (
                <td>{l.burden.length ? l.burden.map((b) => `${lbl(BURDEN_PARTY, b.party)} ${yen(b.amount)}`).join(" / ") : <span className="text-warn">未入力</span>}</td>
              )}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td colSpan={6} className="text-right text-muted">小計（税抜）</td><td className="num">{yen(e.subtotal)}</td>{showBurden && <td />}</tr>
          <tr><td colSpan={6} className="text-right text-muted">消費税</td><td className="num">{yen(e.tax)}</td>{showBurden && <td />}</tr>
          <tr><td colSpan={6} className="text-right font-semibold">合計</td><td className="num font-semibold">{yen(e.total)}</td>{showBurden && <td />}</tr>
        </tfoot>
      </table>
    </div>
  );
}

function DiffBox({ prev, cur }: { prev: EstimateExt | undefined; cur: EstimateExt }) {
  if (!cur.previousId) return null;
  const d = estimateDiff(prev ?? null, cur);
  return (
    <div className="mb-4 rounded-md border border-warn/30 bg-warn-soft p-3 text-sm">
      <p className="font-semibold text-warn">追加・変更版（第{cur.versionNo}版）: 再承認が必要です</p>
      <p className="mt-1">変更理由: {cur.reason ?? "—"}</p>
      <p className="mt-1">
        前版（第{prev?.versionNo ?? "?"}版）合計 {yen(prev?.total ?? null)} → 今回 {yen(cur.total)}（差額{" "}
        <b>{d.totalDiff >= 0 ? "+" : ""}{d.totalDiff.toLocaleString("ja-JP")}円</b>）
      </p>
      {d.added.length > 0 && <p>追加項目: {d.added.join("、")}</p>}
      {d.removed.length > 0 && <p>削除項目: {d.removed.join("、")}</p>}
      {d.changed.length > 0 && <p>金額変更: {d.changed.map((c) => `${c.name} ${yen(c.before)}→${yen(c.after)}`).join("、")}</p>}
    </div>
  );
}

function EstimateTab({
  repairId, estimates, current, canWrite, canApprove, settings, names,
}: {
  repairId: string;
  estimates: EstimateExt[];
  current: EstimateExt | null;
  canWrite: boolean;
  canApprove: boolean;
  settings: { lineRounding: "floor" | "round" | "ceil"; taxRounding: "floor" | "round" | "ceil" };
  names: Map<string, string>;
}) {
  const byId = new Map(estimates.map((e) => [e.id, e]));
  const editable = current && (current.status === "draft" || current.status === "rejected");
  const others = estimates.filter((e) => e.id !== current?.id);
  return (
    <div className="space-y-4">
      {!current ? (
        <Card title="見積明細（第1版）">
          {canWrite ? (
            <EstimateEditor repairId={repairId} initialLines={[]} lineRounding={settings.lineRounding ?? "floor"} taxRounding={settings.taxRounding ?? "floor"} action={saveEstimateDraft} />
          ) : (
            <StateMessage kind="empty" message="見積はまだ登録されていません" />
          )}
        </Card>
      ) : (
        <Card
          title={
            <span className="inline-flex flex-wrap items-center gap-2">
              現行見積 第{current.versionNo}版
              <Badge tone={tone(ESTIMATE_STATUS, current.status)}>{lbl(ESTIMATE_STATUS, current.status)}</Badge>
              {current.submittedByVendor && <Badge tone="info">業者提出</Badge>}
              {current.ownerApprovalRequested && current.status === "submitted" && <Badge tone="warn">オーナー回答待ち</Badge>}
            </span>
          }
          actions={
            <>
              {canWrite && editable && (
                <ActionButton action={submitEstimate} args={{ id: current.id }} label={current.status === "rejected" ? "修正して再申請" : "承認申請"} variant="primary" confirm="この見積を承認申請しますか？（負担額の合計が明細金額と一致している必要があります）" />
              )}
              {canApprove && current.status === "submitted" && (
                <>
                  <ActionButton action={approveEstimate} args={{ id: current.id }} label="承認" variant="primary" confirm={`第${current.versionNo}版（合計 ${yen(current.total)}）を承認しますか？`} />
                  <ActionButton action={rejectEstimate} args={{ id: current.id }} label="差戻し" variant="danger" prompt="差戻しの理由" />
                </>
              )}
              {canWrite && current.status === "submitted" && !current.ownerApprovalRequested && (
                <ActionButton action={requestOwnerApproval} args={{ id: current.id }} label="オーナーに承認を依頼" confirm="オーナーの外部利用者ページに承認依頼を表示します（外部への送信は行いません）" />
              )}
              {canWrite && current.status === "approved" && (
                <ActionButton action={createEstimateRevision} args={{ repairId }} label="追加・変更版を作成" prompt="追加・変更の理由（金額・施工範囲の変更内容）" />
              )}
            </>
          }
        >
          <DiffBox prev={current.previousId ? byId.get(current.previousId) : undefined} cur={current} />
          {current.status === "rejected" && (
            <p className="mb-3 rounded-md bg-danger-soft p-2 text-sm text-danger">
              差戻し理由: {[...current.approvals].reverse().find((a) => a.action === "reject")?.reason ?? "—"}
            </p>
          )}
          {editable && canWrite ? (
            <EstimateEditor
              repairId={repairId}
              initialLines={current.lines}
              version={current.version}
              lineRounding={settings.lineRounding ?? "floor"}
              taxRounding={settings.taxRounding ?? "floor"}
              action={saveEstimateDraft}
            />
          ) : (
            <EstimateLinesTable e={current} />
          )}
          <p className="help mt-3">
            作成: {names.get(current.createdBy) ?? (current.submittedByVendor ? "業者" : "—")} ／ 更新: {formatDateTimeJst(current.updatedAt)}。
            費用負担は明細ごとに担当者が判断して入力します（写真だけから負担者を断定しません）。
          </p>
        </Card>
      )}
      {others.length > 0 && (
        <Card title="過去の版（上書きせず保存）">
          <div className="space-y-2">
            {others.map((e) => (
              <details key={e.id} className="rounded-md border border-line">
                <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2">
                  第{e.versionNo}版 <Badge tone={tone(ESTIMATE_STATUS, e.status)}>{lbl(ESTIMATE_STATUS, e.status)}</Badge> 合計 {yen(e.total)}
                  {e.reason && <span className="text-sm text-muted">理由: {e.reason}</span>}
                </summary>
                <div className="p-3">
                  <EstimateLinesTable e={e} />
                </div>
              </details>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function ApprovalsTab({ estimates }: { estimates: EstimateExt[] }) {
  const rows = estimates.flatMap((e) =>
    (e.approvals ?? []).map((a, i) => ({ key: `${e.id}-${i}`, versionNo: e.versionNo, total: e.total, ...a, external: a.byName.startsWith("オーナー:") ? e.externalApproval : null, authTime: e.externalApprovalAuthTime ?? null })),
  );
  rows.sort((a, b) => b.at.localeCompare(a.at));
  const label = { submit: "承認申請", resubmit: "再申請", approve: "承認", reject: "差戻し・承認しない" } as const;
  if (!rows.length) return <div className="card"><StateMessage kind="empty" message="承認の履歴はまだありません" /></div>;
  return (
    <Card title="承認・差戻しの履歴（全版）">
      <div className="overflow-x-auto">
        <table className="table">
          <thead><tr><th>日時</th><th>版</th><th>操作</th><th>実施者</th><th>理由・コメント</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{formatDateTimeJst(r.at)}</td>
                <td>第{r.versionNo}版（{yen(r.total)}）</td>
                <td><Badge tone={r.action === "approve" ? "ok" : r.action === "reject" ? "danger" : "warn"}>{label[r.action]}</Badge></td>
                <td>
                  {r.byName}
                  {r.external && (
                    <p className="help">
                      外部利用者ページでの回答（認証時刻 {r.authTime ? formatDateTimeJst(new Date(r.authTime * 1000).toISOString()) : "—"}）。
                      内容を確認し回答した記録であり、電子署名による契約締結ではありません。
                    </p>
                  )}
                </td>
                <td className="break-words">{r.reason ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
