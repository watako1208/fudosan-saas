import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffPage, canAccessStore, Ctx } from "@/lib/server/session";
import { getDoc, findDocs, getMany } from "@/lib/server/repo";
import { tabOf, SP } from "@/lib/server/query";
import { staffName, staffNameMap } from "@/lib/server/lookups";
import { listAttachments } from "@/lib/server/attachments";
import { archiveDeal, createDealDocTasks } from "@/lib/server/actions/deals";
import { createProposal } from "@/lib/server/actions/proposals";
import { C, Deal, Party, Property, Unit, Contract, Activity, EventDoc, ApplicationDoc, TaskDoc } from "@/lib/types";
import type { Proposal } from "@/lib/types-deals";
import { DetailHeader, Tabs, Card, DL, Badge, StateMessage } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { FileManager } from "@/components/FileManager";
import { ActivityForm } from "@/components/parties/ActivityForm";
import { ActivityList } from "@/components/parties/ActivityList";
import { DealStatusControl } from "@/components/deals/DealStatusControl";
import { TaskTable } from "@/components/schedule/TaskTable";
import { lbl, tone } from "@/lib/labels";
import { DEAL_KIND, DEAL_SIDE, EVENT_TYPE, APPLICATION_STATUS, LANDLORD_CHECK, REACTION_KIND, dealStatuses, dealStatusTone } from "@/lib/labels-deals";
import { CONTRACT_STATUSES, labelOf } from "@/lib/domain/rules";
import { formatDateTimeJst, todayJst } from "@/lib/domain/dates";
import { yen } from "@/lib/domain/money";

const TABS = ["overview", "proposals", "activities", "viewings", "applications", "contract", "tasks", "files"];

export default async function DealDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const ctx = await requireStaffPage("deal.read");
  const { id } = await params;
  const sp = await searchParams;
  const d = await getDoc<Deal>(ctx, C.deals, id);
  if (!d) notFound();
  const tab = tabOf(sp, TABS, "overview");
  const canEdit = ctx.caps.has("deal.write") && canAccessStore(ctx, d.storeId);
  const base = `/deals/${id}`;
  const customer = d.customerId ? await getDoc<Party>(ctx, C.parties, d.customerId) : null;
  const statuses = dealStatuses(d.kind);

  return (
    <>
      <DetailHeader
        back={{ href: "/deals", label: "仲介案件一覧" }}
        number={d.number}
        title={d.title}
        badges={
          <>
            <Badge>{lbl(DEAL_KIND, d.kind)}{d.side ? `・${lbl(DEAL_SIDE, d.side)}` : ""}</Badge>
            <Badge tone={dealStatusTone(d.status)}>{labelOf(statuses, d.status)}</Badge>
            {d.archived && <Badge>アーカイブ</Badge>}
            {!canAccessStore(ctx, d.storeId) && <Badge tone="warn">他店舗の案件（閲覧のみ）</Badge>}
          </>
        }
        meta={
          <>
            <span>顧客: {customer ? <Link className="text-primary hover:underline" href={`/parties/${customer.id}`}>{customer.name}</Link> : "未設定"}</span>
            <span>担当: {await staffName(ctx, d.assigneeUid)}</span>
            <span>見込: {yen(d.expectedAmount)}</span>
            <span>次回対応: {d.nextActionDate ?? "未設定"}{d.nextActionDate && d.nextActionDate < todayJst() && <span className="ml-1"><Badge tone="danger">期限超過</Badge></span>}</span>
          </>
        }
        actions={
          canEdit && (
            <>
              <DealStatusControl id={id} status={d.status} statuses={statuses} version={d.version} />
              <Link href={`${base}/edit`} className="btn btn-primary">編集</Link>
              <ActionButton action={archiveDeal} args={{ id }} label={d.archived ? "アーカイブ解除" : "アーカイブ"} confirm={d.archived ? "アーカイブを解除しますか？" : "この案件をアーカイブしますか？（データは削除されません）"} />
            </>
          )
        }
      />
      <Tabs
        base={base}
        current={tab}
        tabs={[
          { key: "overview", label: "概要" },
          { key: "proposals", label: "提案物件" },
          { key: "activities", label: "対応記録" },
          { key: "viewings", label: "内見" },
          { key: "applications", label: "申込み" },
          { key: "contract", label: "契約準備" },
          { key: "tasks", label: "タスク" },
          { key: "files", label: "資料" },
        ]}
      />
      {tab === "overview" && <OverviewTab ctx={ctx} d={d} customer={customer} />}
      {tab === "proposals" && <ProposalsTab ctx={ctx} d={d} canEdit={canEdit} />}
      {tab === "activities" && <ActivitiesTab ctx={ctx} d={d} canEdit={canEdit} />}
      {tab === "viewings" && <ViewingsTab ctx={ctx} d={d} />}
      {tab === "applications" && <ApplicationsTab ctx={ctx} d={d} canEdit={canEdit} />}
      {tab === "contract" && <ContractTab ctx={ctx} d={d} canEdit={canEdit} />}
      {tab === "tasks" && <TasksTab ctx={ctx} d={d} />}
      {tab === "files" && (
        <FileManager
          entity="deal"
          entityId={id}
          canWrite={canEdit}
          allowSensitive={ctx.caps.has("party.sensitive")}
          categories={["申込書", "本人確認書類", "収入証明", "図面", "重要事項説明", "契約書", "見積書", "その他"]}
          items={(await listAttachments(ctx, "deal", id)).map(({ id, fileName, contentType, category, description, visibility, takenAt, sort, size, sensitive }) => ({ id, fileName, contentType, category, description, visibility, takenAt, sort, size, sensitive }))}
        />
      )}
    </>
  );
}

async function targetsOf(ctx: Ctx, d: Deal) {
  const props = await getMany<Property>(ctx, C.properties, d.propertyIds ?? []);
  const units = await getMany<Unit>(ctx, C.units, d.unitIds ?? []);
  return { props, units };
}

async function OverviewTab({ ctx, d, customer }: { ctx: Ctx; d: Deal; customer: Party | null }) {
  const { props, units } = await targetsOf(ctx, d);
  return (
    <div className="space-y-4">
      <Card title="案件の概要">
        <DL
          items={[
            ["案件番号", d.number],
            ["区分", `${lbl(DEAL_KIND, d.kind)}${d.side ? `（${lbl(DEAL_SIDE, d.side)}）` : ""}`],
            ["顧客", customer ? <Link key="c" className="text-primary hover:underline" href={`/parties/${customer.id}`}>{customer.name}（{customer.number}）</Link> : null],
            ["連絡先", customer ? [customer.phone ?? customer.mobile, customer.email].filter(Boolean).join(" / ") || null : null],
            ["担当", await staffName(ctx, d.assigneeUid)],
            ["見込金額", d.expectedAmount !== null ? yen(d.expectedAmount) : null],
            ["次回対応日", d.nextActionDate],
            ["次回対応の内容", d.nextAction],
            ["失注・終了理由", d.lostReason],
          ]}
        />
      </Card>
      <Card title="希望条件">{d.conditions ? <p className="whitespace-pre-wrap">{d.conditions}</p> : <p className="text-muted">未入力</p>}</Card>
      <Card title="対象物件">
        {(d.propertyIds ?? []).length === 0 ? (
          <p className="text-muted">対象物件は未設定です（編集から追加できます）</p>
        ) : (
          <ul className="space-y-1">
            {(d.propertyIds ?? []).map((pid) => {
              const p = props.get(pid);
              const us = [...units.values()].filter((u) => u.propertyId === pid);
              return (
                <li key={pid}>
                  <Link className="text-primary hover:underline" href={`/properties/${pid}`}>{p ? `${p.number} ${p.name}` : "（閲覧できない物件）"}</Link>
                  {us.length > 0 && (
                    <span className="ml-2 text-sm">
                      部屋:{" "}
                      {us.map((u, i) => (
                        <span key={u.id}>{i > 0 && "、"}<Link className="text-primary hover:underline" href={`/properties/${pid}/units/${u.id}`}>{u.number}</Link></span>
                      ))}
                    </span>
                  )}
                  {p?.priceLabel && <span className="ml-2 text-sm text-muted">{p.priceLabel}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

async function ProposalsTab({ ctx, d, canEdit }: { ctx: Ctx; d: Deal; canEdit: boolean }) {
  const list = (await findDocs<Proposal>(ctx, C.proposals, [["dealId", "==", d.id]], 100)).filter((p) => !p.archived).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <ActionButton action={createProposal} args={{ dealId: d.id }} label="＋ 新しい提案を作成" variant="primary" />
          <span className="help">登録済みの物件・部屋から作成し、比較表と印刷用ページ（ブラウザでPDF保存）を出力できます。</span>
        </div>
      )}
      {list.length === 0 && <div className="card"><StateMessage kind="empty" message="提案はまだありません" /></div>}
      {list.map((p) => (
        <Card
          key={p.id}
          title={<Link className="text-primary hover:underline" href={`/deals/${d.id}/proposals/${p.id}`}>{p.title}</Link>}
          actions={
            <>
              {p.publishedToCustomer ? <Badge tone="info">顧客ページに公開中</Badge> : <Badge>未公開</Badge>}
              <Link className="btn btn-secondary btn-sm" href={`/deals/${d.id}/proposals/${p.id}/print`}>印刷・PDF</Link>
            </>
          }
        >
          <p className="mb-2 text-sm text-muted">候補 {p.items.length}件 ／ 作成 {formatDateTimeJst(p.createdAt)}{p.publishedAt ? ` ／ 公開 ${formatDateTimeJst(p.publishedAt)}` : ""}</p>
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>候補</th><th className="num">賃料・価格</th><th>顧客の反応</th></tr></thead>
              <tbody>
                {p.items.map((it, i) => {
                  const rs = (p.reactions ?? []).filter((r) => r.itemIndex === i).sort((a, b) => (a.at < b.at ? 1 : -1));
                  return (
                    <tr key={i}>
                      <td>{it.propertyName}{it.unitNumber ? ` ${it.unitNumber}` : ""}</td>
                      <td className="num">{yen(it.dealType === "sale" ? it.price : it.rent)}</td>
                      <td>
                        {rs.length === 0 ? <span className="text-muted">反応なし</span> : (
                          <ul className="space-y-0.5">
                            {rs.map((r, j) => (
                              <li key={j} className="text-sm">
                                <Badge tone={tone(REACTION_KIND, r.kind)}>{lbl(REACTION_KIND, r.kind)}</Badge>
                                {r.reason && <span className="ml-1">理由: {r.reason}</span>}
                                <span className="ml-1 text-xs text-muted">{formatDateTimeJst(r.at)}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </div>
  );
}

async function ActivitiesTab({ ctx, d, canEdit }: { ctx: Ctx; d: Deal; canEdit: boolean }) {
  const acts = await findDocs<Activity>(ctx, C.activities, [["entity", "==", "deal"], ["entityId", "==", d.id]], 300);
  return (
    <div className="space-y-4">
      {canEdit && <ActivityForm entity="deal" entityId={d.id} />}
      <ActivityList items={acts} names={await staffNameMap(ctx)} canWrite={canEdit} uid={ctx.uid} />
    </div>
  );
}

async function ViewingsTab({ ctx, d }: { ctx: Ctx; d: Deal }) {
  if (!ctx.caps.has("schedule.read")) return <div className="card"><StateMessage kind="forbidden" /></div>;
  const evs = (await findDocs<EventDoc>(ctx, C.events, [["dealId", "==", d.id]], 200)).filter((e) => !e.archived).sort((a, b) => (a.start < b.start ? 1 : -1));
  const props = await getMany<Property>(ctx, C.properties, evs.map((e) => e.propertyId ?? ""));
  const names = await staffNameMap(ctx);
  const qs = new URLSearchParams({ dealId: d.id, type: "viewing", ...(d.customerId ? { partyId: d.customerId } : {}), ...(d.propertyIds?.[0] ? { propertyId: d.propertyIds[0] } : {}) });
  return (
    <Card title="内見・予定" actions={ctx.caps.has("schedule.write") && <Link className="btn btn-primary btn-sm" href={`/schedule/new?${qs.toString()}`}>＋ 内見を登録</Link>}>
      {evs.length === 0 ? (
        <StateMessage kind="empty" message="この案件の予定はまだありません" />
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>日時</th><th>種類</th><th>件名</th><th>物件</th><th>担当</th><th>実施結果</th><th></th></tr></thead>
            <tbody>
              {evs.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap">{formatDateTimeJst(e.start)}</td>
                  <td>{lbl(EVENT_TYPE, e.type)}</td>
                  <td><Link className="text-primary hover:underline" href={`/schedule/${e.id}`}>{e.title}</Link></td>
                  <td>{e.propertyId ? props.get(e.propertyId)?.name ?? "—" : "—"}</td>
                  <td>{e.assigneeUid ? names.get(e.assigneeUid) ?? "—" : "未設定"}</td>
                  <td className="max-w-64 break-words">{e.done ? <><Badge tone="ok">実施済み</Badge> {e.result}</> : <Badge>未実施</Badge>}</td>
                  <td>{ctx.caps.has("schedule.write") && !e.done && <Link className="btn btn-secondary btn-sm" href={`/schedule/${e.id}/result`}>内見記録</Link>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

async function ApplicationsTab({ ctx, d, canEdit }: { ctx: Ctx; d: Deal; canEdit: boolean }) {
  const apps = (await findDocs<ApplicationDoc>(ctx, C.applications, [["dealId", "==", d.id]], 100)).filter((a) => !a.archived).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const parties = await getMany<Party>(ctx, C.parties, apps.map((a) => a.applicantId));
  const names = await staffNameMap(ctx);
  return (
    <Card title="申込み" actions={canEdit && <Link className="btn btn-primary btn-sm" href={`/deals/${d.id}/applications/new`}>＋ 申込みを登録</Link>}>
      <p className="mb-3 text-sm text-muted">保証会社の審査は外部で実施し、結果のみを記録します（審査申請の連携は行いません）。</p>
      {apps.length === 0 ? (
        <StateMessage kind="empty" message="申込みはまだありません" />
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>申込者</th><th>状態</th><th>希望入居日</th><th>提出書類</th><th>保証会社</th><th>貸主確認</th><th>結果記録</th></tr></thead>
            <tbody>
              {apps.map((a) => {
                const got = a.submittedDocs.filter((x) => x.received).length;
                return (
                  <tr key={a.id}>
                    <td><Link className="text-primary hover:underline" href={`/deals/${d.id}/applications/${a.id}`}>{parties.get(a.applicantId)?.name ?? "（不明）"}</Link></td>
                    <td><Badge tone={tone(APPLICATION_STATUS, a.status)}>{lbl(APPLICATION_STATUS, a.status)}</Badge></td>
                    <td>{a.desiredMoveIn ?? "—"}</td>
                    <td>{got}/{a.submittedDocs.length}件 受領{got < a.submittedDocs.length && <span className="ml-1"><Badge tone="warn">不足あり</Badge></span>}</td>
                    <td>{a.guarantorCompany ?? "—"}</td>
                    <td>{a.landlordCheck ? <Badge tone={tone(LANDLORD_CHECK, a.landlordCheck)}>{lbl(LANDLORD_CHECK, a.landlordCheck)}</Badge> : "—"}</td>
                    <td className="text-xs">{a.resultRecordedBy ? `${names.get(a.resultRecordedBy) ?? "—"} ${formatDateTimeJst(a.resultRecordedAt)}` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

async function ContractTab({ ctx, d, canEdit }: { ctx: Ctx; d: Deal; canEdit: boolean }) {
  const canContract = ctx.caps.has("contract.read");
  let contracts: Contract[] = [];
  if (canContract) {
    const linked = await findDocs<Contract>(ctx, C.contracts, [["dealId", "==", d.id]], 50);
    const direct = d.contractId ? await getDoc<Contract>(ctx, C.contracts, d.contractId) : null;
    contracts = [...new Map([...(direct ? [direct] : []), ...linked].map((c) => [c.id, c])).values()].filter((c) => !c.archived);
  }
  const { props, units } = await targetsOf(ctx, d);
  const tasks = (await findDocs<TaskDoc>(ctx, C.tasks, [["entity", "==", "deal"], ["entityId", "==", d.id]], 300))
    .filter((t) => !t.archived && (t.sourceKey ?? "").startsWith("dealdoc_"))
    .sort((a, b) => (a.sourceKey ?? "").localeCompare(b.sourceKey ?? "", "ja", { numeric: true }));
  const names = await staffNameMap(ctx);
  const canCreateContract = ctx.caps.has("contract.write");
  const targets = [...units.values()].map((u) => ({ unitId: u.id as string | null, label: `${props.get(u.propertyId)?.name ?? ""} ${u.number}` }));
  return (
    <div className="space-y-4">
      <Card title="契約">
        {!canContract ? (
          <StateMessage kind="forbidden" message="契約を閲覧する権限がありません" />
        ) : contracts.length === 0 ? (
          <p className="text-muted">この案件に関連づけられた契約はまだありません</p>
        ) : (
          <table className="table">
            <thead><tr><th>契約番号</th><th>件名</th><th>状態</th><th>期間</th></tr></thead>
            <tbody>
              {contracts.map((c) => (
                <tr key={c.id}>
                  <td><Link className="text-primary hover:underline" href={`/contracts/${c.id}`}>{c.number}</Link></td>
                  <td>{c.title}</td>
                  <td><Badge tone={["approved", "executed", "active"].includes(c.status) ? "ok" : c.status === "in_review" ? "warn" : "neutral"}>{labelOf(CONTRACT_STATUSES, c.status)}</Badge></td>
                  <td>{c.start ?? "未定"}〜{c.end ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {canCreateContract && canEdit && (
          <div className="mt-3 flex flex-wrap gap-2">
            {targets.length > 0 ? (
              targets.map((t) => (
                <Link key={t.unitId} className="btn btn-primary" href={`/contracts/new?dealId=${d.id}&unitId=${t.unitId}`}>
                  {t.label} の契約書下書きを作成
                </Link>
              ))
            ) : (
              <Link className="btn btn-primary" href={`/contracts/new?dealId=${d.id}`}>案件から契約書下書きを作成</Link>
            )}
            <p className="help w-full">案件の顧客・対象の部屋・現在の募集条件を引き継いで下書きを作成します（同じ内容の再入力は不要です）。</p>
          </div>
        )}
      </Card>
      <Card
        title="必要書類チェックリスト"
        actions={canEdit && ctx.caps.has("schedule.read") && <ActionButton action={createDealDocTasks} args={{ id: d.id }} label="必要書類をタスクとして作成" size="sm" />}
      >
        {tasks.length === 0 ? (
          <p className="text-muted">必要書類のタスクはまだありません。ボタンから標準の必要書類を作成できます（作成済みの書類は重複しません）。</p>
        ) : (
          <>
            <p className="mb-2 text-sm">完了 {tasks.filter((t) => t.done).length} / {tasks.length} 件</p>
            <TaskTable tasks={tasks} names={names} today={todayJst()} canWrite={ctx.caps.has("schedule.write")} showEntity={false} />
          </>
        )}
      </Card>
    </div>
  );
}

async function TasksTab({ ctx, d }: { ctx: Ctx; d: Deal }) {
  if (!ctx.caps.has("schedule.read")) return <div className="card"><StateMessage kind="forbidden" /></div>;
  const tasks = (await findDocs<TaskDoc>(ctx, C.tasks, [["entity", "==", "deal"], ["entityId", "==", d.id]], 300))
    .filter((t) => !t.archived)
    .sort((a, b) => Number(a.done) - Number(b.done) || (a.due < b.due ? -1 : 1));
  return (
    <Card title="タスク" actions={ctx.caps.has("schedule.write") && <Link className="btn btn-primary btn-sm" href={`/schedule/tasks/new?entity=deal&entityId=${d.id}`}>＋ タスクを追加</Link>}>
      {tasks.length === 0 ? (
        <StateMessage kind="empty" message="タスクはありません" />
      ) : (
        <TaskTable tasks={tasks} names={await staffNameMap(ctx)} today={todayJst()} canWrite={ctx.caps.has("schedule.write")} showEntity={false} />
      )}
    </Card>
  );
}
