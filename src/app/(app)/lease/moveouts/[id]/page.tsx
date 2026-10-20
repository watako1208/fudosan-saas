import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffPage } from "@/lib/server/session";
import { getDoc, findDocs } from "@/lib/server/repo";
import { tabOf, SP } from "@/lib/server/query";
import { staffName, staffNameMap, staffOptions } from "@/lib/server/lookups";
import { listAttachments } from "@/lib/server/attachments";
import { completeMoveout, removeBurdenDecision } from "@/lib/server/actions/lease";
import { C, Moveout, Contract, ContractVersion, Invoice, DepositEntryDoc, Unit, Property } from "@/lib/types";
import { DetailHeader, Tabs, Card, DL, Badge, StateMessage } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { FileManager } from "@/components/FileManager";
import { Steps } from "@/components/lease/Steps";
import { MoveoutForm, BurdenForm } from "@/components/lease/LeaseForms";
import { DepositPanel } from "@/components/lease/DepositPanel";
import { lbl, tone } from "@/lib/labels";
import { MOVEOUT_STATUS, BURDEN_PARTY } from "@/lib/labels-contracts";
import { MOVEOUT_STATUSES, depositBalance } from "@/lib/domain/rules";
import { earliestTerminationDate, versionAt } from "@/lib/domain/contracts";
import { yen } from "@/lib/domain/money";
import { todayJst, formatDateTimeJst } from "@/lib/domain/dates";

const TABS = ["basic", "burden", "deposit", "files"];

export default async function MoveoutDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const ctx = await requireStaffPage("lease.read");
  const { id } = await params;
  const sp = await searchParams;
  const m = await getDoc<Moveout>(ctx, C.moveouts, id);
  if (!m) notFound();
  const c = await getDoc<Contract>(ctx, C.contracts, m.contractId);
  if (!c) notFound();
  const tab = tabOf(sp, TABS, "basic");
  const canWrite = ctx.caps.has("lease.write") && m.status !== "completed";
  const versions = (await findDocs<ContractVersion>(ctx, C.contractVersions, [["contractId", "==", c.id]])).filter((v) => !v.archived);
  // 解約日時点で適用される確定版（なければ現在の版）の計算設定を使う
  const ver = (m.confirmedDate ? versionAt(versions, m.confirmedDate) : null) ?? versions.find((v) => v.id === c.currentVersionId) ?? null;
  const unit = m.unitId ? await getDoc<Unit>(ctx, C.units, m.unitId) : null;
  const prop = unit ? await getDoc<Property>(ctx, C.properties, unit.propertyId) : null;
  const deposits = await findDocs<DepositEntryDoc>(ctx, C.deposits, [["contractId", "==", c.id]]);
  const dep = depositBalance(deposits.filter((d) => !d.archived));
  const earliest = earliestTerminationDate(m.requestedAt, ver?.termination?.noticeRule ?? null);
  const base = `/lease/moveouts/${id}`;
  const burdenTotal = (party: string) => (m.burdenDecisions ?? []).filter((b) => b.party === party).reduce((s, b) => s + b.amount, 0);

  return (
    <>
      <DetailHeader
        back={{ href: "/lease?tab=moveouts", label: "解約・退去精算" }}
        number={c.number}
        title={`解約・退去: ${c.title}`}
        badges={<Badge tone={tone(MOVEOUT_STATUS, m.status)}>{lbl(MOVEOUT_STATUS, m.status)}</Badge>}
        meta={
          <>
            <span>申出 {m.requestedAt}</span>
            <span>解約日 {m.confirmedDate ?? "未確定"}</span>
            {unit && <span>{prop?.name} {unit.number}</span>}
            <Link className="text-primary hover:underline" href={`/contracts/${c.id}`}>契約を表示</Link>
          </>
        }
        actions={
          <>
            {ctx.caps.has("billing.write") && <Link className="btn btn-secondary" href={`/billing/new?contractId=${c.id}&kind=one_time`}>最終請求を作成</Link>}
            {ctx.caps.has("document.write") && <Link className="btn btn-secondary" href={`/documents/new?entity=moveout&entityId=${id}&docType=moveout_settlement`}>退去精算書を作成</Link>}
            {canWrite && (
              <ActionButton
                action={completeMoveout}
                args={{ id }}
                variant="primary"
                label="退去精算を完了"
                confirm={`退去精算を完了します。契約を終了（終了日 ${m.confirmedDate ?? "未確定"}）し、部屋を空室にします。よろしいですか？`}
              />
            )}
          </>
        }
      />
      <Steps steps={MOVEOUT_STATUSES.map(([k, l]) => ({ key: k, label: l }))} current={m.status} />
      <Tabs
        base={base}
        current={tab}
        tabs={[
          { key: "basic", label: "解約日・影響" },
          { key: "burden", label: "費用負担", count: m.burdenDecisions?.length ?? 0 },
          { key: "deposit", label: "敷金精算" },
          { key: "files", label: "写真・資料" },
        ]}
      />
      {tab === "basic" && (
        <div className="space-y-4">
          <Card title="契約条件">
            <DL
              items={[
                ["契約期間", `${c.start ?? "未定"}〜${c.end ?? "定めなし"}`],
                ["解約予告", ver?.termination?.noticeRule ? `${ver.termination.noticeRule.amount}${ver.termination.noticeRule.unit === "months" ? "か月" : "日"}前` : null],
                ["申出日からの最短解約日", earliest],
                ["預り残高（全保管主体）", yen(dep.balance)],
                ["鍵の返却", m.keysReturned === null ? null : `${m.keysReturned}本`],
                ["立会い", m.inspectionAt ? m.inspectionAt.replace("T", " ") : null],
              ]}
            />
          </Card>
          {canWrite ? (
            <MoveoutForm
              id={id}
              version={m.version}
              initial={JSON.parse(JSON.stringify(m))}
              contractId={c.id}
              contractStart={c.start}
              contractEnd={c.end}
              versionFrom={ver?.effectiveFrom ?? null}
              monthlyItems={ver?.monthlyItems ?? []}
              invoices={await impactInvoices(ctx, c.id)}
              invoicesReadable={ctx.caps.has("billing.read")}
            />
          ) : (
            <Card title="記録">
              <DL items={[["希望解約日", m.desiredDate], ["確認済み解約日", m.confirmedDate], ["メモ", m.impactNote]]} />
              {m.status === "completed" && <p className="help mt-2">完了済みのため編集できません（{formatDateTimeJst(m.updatedAt)}）。</p>}
            </Card>
          )}
        </div>
      )}
      {tab === "burden" && (
        <div className="space-y-4">
          <Card title="費用負担の判断">
            {(m.burdenDecisions ?? []).length === 0 ? (
              <StateMessage kind="empty" message="まだ判断の記録はありません" />
            ) : (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead><tr><th>項目</th><th>負担者</th><th className="num">金額</th><th>判断理由</th><th>確認者</th><th></th></tr></thead>
                  <tbody>
                    {await Promise.all(
                      m.burdenDecisions.map(async (b, i) => (
                        <tr key={i}>
                          <td>{b.item}</td>
                          <td>{lbl(BURDEN_PARTY, b.party)}</td>
                          <td className="num">{yen(b.amount)}</td>
                          <td className="max-w-72 whitespace-pre-wrap">{b.reason}</td>
                          <td>{await staffName(ctx, b.checkedBy)}</td>
                          <td>{canWrite && <ActionButton size="sm" variant="ghost" action={removeBurdenDecision} args={{ id, index: i }} label="取消" prompt="取り消す理由を入力してください" />}</td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-sm">
              借主負担 {yen(burdenTotal("lessee"))}／貸主負担 {yen(burdenTotal("lessor"))}／自社負担 {yen(burdenTotal("company"))}／その他 {yen(burdenTotal("other"))}
            </p>
            <p className="help">借主負担分は「敷金精算」で充当（承認が必要）または追加請求として記録します。</p>
          </Card>
          {canWrite && <BurdenForm moveoutId={id} staff={await staffOptions(ctx)} defaultBy={ctx.uid} />}
        </div>
      )}
      {tab === "deposit" && (
        <DepositPanel
          contractId={c.id}
          moveoutId={id}
          entries={deposits}
          depositAmount={ver?.depositAmount ?? null}
          defaultHolder={c.depositHolder}
          canWrite={canWrite}
          canApprove={ctx.caps.has("contract.approve") || ctx.caps.has("billing.confirm")}
          attachments={[...(await listAttachments(ctx, "moveout", id)), ...(await listAttachments(ctx, "contract", c.id))].map((f) => ({ value: f.id, label: f.fileName }))}
          today={todayJst()}
          names={await staffNameMap(ctx)}
        />
      )}
      {tab === "files" && (
        <FileManager
          entity="moveout"
          entityId={id}
          canWrite={ctx.caps.has("lease.write")}
          categories={["退去立会い", "室内", "工事写真（前）", "工事写真（後）", "見積書", "返金記録", "その他"]}
          items={(await listAttachments(ctx, "moveout", id)).map(({ id, fileName, contentType, category, description, visibility, takenAt, sort, size, sensitive }) => ({ id, fileName, contentType, category, description, visibility, takenAt, sort, size, sensitive }))}
        />
      )}
    </>
  );
}

/** 影響表示用の請求（読み取りのみ。請求は変更しない） */
async function impactInvoices(ctx: Awaited<ReturnType<typeof requireStaffPage>>, contractId: string) {
  if (!ctx.caps.has("billing.read")) return [];
  const list = await findDocs<Invoice>(ctx, C.invoices, [["contractId", "==", contractId]]);
  return list.filter((i) => !i.archived).map((i) => ({ id: i.id, number: i.number, kind: i.kind, period: i.period, status: i.status, total: i.total }));
}
