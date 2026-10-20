import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffPage, Ctx } from "@/lib/server/session";
import { getDoc, findDocs, getMany } from "@/lib/server/repo";
import { tabOf, SP } from "@/lib/server/query";
import { staffName, staffNameMap } from "@/lib/server/lookups";
import { listAttachments } from "@/lib/server/attachments";
import { archiveParty, removePartyRole } from "@/lib/server/actions/parties";
import { C, Party, PartyRole, Property, Unit, Deal, Contract, Ownership, Activity } from "@/lib/types";
import type { PartyExt } from "@/lib/types-deals";
import { DetailHeader, Tabs, Card, DL, Badge, StateMessage } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { FileManager } from "@/components/FileManager";
import { RoleAddForm } from "@/components/parties/RoleAddForm";
import { ActivityForm } from "@/components/parties/ActivityForm";
import { ActivityList } from "@/components/parties/ActivityList";
import { PARTY_ROLE, lbl, tone } from "@/lib/labels";
import { PARTY_TYPE, SUPPORT_STATUS, DEAL_KIND, ROLE_ENTITY, dealStatuses, dealStatusTone } from "@/lib/labels-deals";
import { CONTRACT_STATUSES, labelOf } from "@/lib/domain/rules";
import { formatDateTimeJst, todayJst } from "@/lib/domain/dates";
import { yen } from "@/lib/domain/money";

const TABS = ["basic", "roles", "deals", "activities", "files"];

export default async function PartyDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const ctx = await requireStaffPage("party.read");
  const { id } = await params;
  const sp = await searchParams;
  const p = await getDoc<PartyExt>(ctx, C.parties, id);
  if (!p) notFound();
  const tab = tabOf(sp, TABS, "basic");
  const canWrite = ctx.caps.has("party.write");
  const base = `/parties/${id}`;
  const roles = (await findDocs<PartyRole>(ctx, C.partyRoles, [["partyId", "==", id]])).filter((r) => !r.archived);

  return (
    <>
      <DetailHeader
        back={{ href: "/parties", label: "顧客一覧" }}
        number={p.number}
        title={p.name}
        badges={
          <>
            <Badge>{lbl(PARTY_TYPE, p.type)}</Badge>
            <Badge tone={tone(SUPPORT_STATUS, p.supportStatus)}>{lbl(SUPPORT_STATUS, p.supportStatus ?? "none")}</Badge>
            {(p.roles ?? []).map((r) => <Badge key={r}>{lbl(PARTY_ROLE, r)}</Badge>)}
            {p.archived && <Badge>アーカイブ</Badge>}
          </>
        }
        meta={
          <>
            <span>担当: {await staffName(ctx, p.assigneeUid)}</span>
            {p.kana && <span>{p.kana}</span>}
            <span>{p.phone ?? p.mobile ?? "電話未入力"}</span>
            <span>更新: {formatDateTimeJst(p.updatedAt)}</span>
          </>
        }
        actions={
          <>
            {canWrite && <Link href={`${base}/edit`} className="btn btn-primary">編集</Link>}
            {ctx.caps.has("deal.write") && <Link href={`/deals/new?customerId=${id}`} className="btn btn-secondary">案件を作成</Link>}
            {ctx.caps.has("schedule.write") && <Link href={`/schedule/new?partyId=${id}`} className="btn btn-secondary">予定を登録</Link>}
            {canWrite && (
              <ActionButton
                action={archiveParty}
                args={{ id }}
                label={p.archived ? "アーカイブ解除" : "アーカイブ"}
                confirm={p.archived ? "アーカイブを解除しますか？" : "この顧客をアーカイブしますか？（取引履歴は削除されません）"}
              />
            )}
          </>
        }
      />
      <Tabs
        base={base}
        current={tab}
        tabs={[
          { key: "basic", label: "基本情報" },
          { key: "roles", label: "役割・関連", count: roles.length },
          { key: "deals", label: "案件" },
          { key: "activities", label: "対応履歴" },
          { key: "files", label: "書類・資料" },
        ]}
      />
      {tab === "basic" && <BasicTab ctx={ctx} p={p} />}
      {tab === "roles" && <RolesTab ctx={ctx} p={p} roles={roles} canWrite={canWrite} />}
      {tab === "deals" && <DealsTab ctx={ctx} p={p} roles={roles} />}
      {tab === "activities" && <ActivitiesTab ctx={ctx} partyId={id} canWrite={canWrite} />}
      {tab === "files" && (
        <FileManager
          entity="party"
          entityId={id}
          canWrite={canWrite}
          allowSensitive={ctx.caps.has("party.sensitive")}
          categories={["本人確認書類", "収入証明", "住民票", "印鑑証明", "申込書", "契約書", "その他"]}
          items={(await listAttachments(ctx, "party", id)).map(({ id, fileName, contentType, category, description, visibility, takenAt, sort, size, sensitive }) => ({ id, fileName, contentType, category, description, visibility, takenAt, sort, size, sensitive }))}
        />
      )}
    </>
  );
}

async function BasicTab({ ctx, p }: { ctx: Ctx; p: PartyExt }) {
  const corp = p.corporationId ? await getDoc<Party>(ctx, C.parties, p.corporationId) : null;
  const members = p.type === "corporation" ? (await findDocs<Party>(ctx, C.parties, [["corporationId", "==", p.id]], 100)).filter((m) => !m.archived) : [];
  return (
    <div className="space-y-4">
      <Card title="基本情報">
        <DL
          items={[
            ["顧客番号", p.number],
            ["区分", lbl(PARTY_TYPE, p.type)],
            [p.type === "corporation" ? "法人名" : "氏名", p.name],
            ["読み", p.kana],
            ["電話", p.phone],
            ["携帯", p.mobile],
            ["メール", p.email],
            ["郵便番号", p.postalCode],
            ["住所", p.address],
            ...(p.type === "person" ? ([["生年月日", p.birthDate]] as [string, string | null][]) : []),
            ["所属法人", corp ? <Link key="c" className="text-primary hover:underline" href={`/parties/${corp.id}`}>{corp.name}</Link> : null],
          ]}
        />
      </Card>
      {p.type === "corporation" && (
        <Card title="担当者" actions={ctx.caps.has("party.write") && <Link className="btn btn-secondary btn-sm" href={`/parties/new?corporationId=${p.id}`}>＋ 担当者を登録</Link>}>
          {members.length === 0 ? (
            <p className="text-muted">担当者は登録されていません</p>
          ) : (
            <ul className="space-y-1">
              {members.map((m) => (
                <li key={m.id}>
                  <Link className="text-primary hover:underline" href={`/parties/${m.id}`}>{m.name}</Link>
                  <span className="ml-2 text-sm text-muted">{[m.phone ?? m.mobile, m.email].filter(Boolean).join(" / ")}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      <Card title="希望条件">{p.preferences ? <p className="whitespace-pre-wrap">{p.preferences}</p> : <p className="text-muted">未入力</p>}</Card>
      {p.memo && <Card title="社内メモ（外部には非表示）"><p className="whitespace-pre-wrap">{p.memo}</p></Card>}
    </div>
  );
}

function entityHref(r: { entity: string; entityId: string }, units: Map<string, Unit>): string {
  if (r.entity === "property") return `/properties/${r.entityId}`;
  if (r.entity === "unit") {
    const u = units.get(r.entityId);
    return u ? `/properties/${u.propertyId}/units/${u.id}` : "#";
  }
  if (r.entity === "deal") return `/deals/${r.entityId}`;
  return `/contracts/${r.entityId}`;
}

async function RolesTab({ ctx, p, roles, canWrite }: { ctx: Ctx; p: PartyExt; roles: PartyRole[]; canWrite: boolean }) {
  const ids = (e: string) => roles.filter((r) => r.entity === e).map((r) => r.entityId);
  const owns = (await findDocs<Ownership>(ctx, C.ownerships, [["partyId", "==", p.id]])).filter((o) => !o.archived);
  const [props, units, deals, contracts] = await Promise.all([
    getMany<Property>(ctx, C.properties, [...ids("property"), ...owns.map((o) => o.propertyId)]),
    getMany<Unit>(ctx, C.units, ids("unit")),
    ctx.caps.has("deal.read") ? getMany<Deal>(ctx, C.deals, ids("deal")) : Promise.resolve(new Map<string, Deal>()),
    ctx.caps.has("contract.read") ? getMany<Contract>(ctx, C.contracts, ids("contract")) : Promise.resolve(new Map<string, Contract>()),
  ]);
  const unitProps = await getMany<Property>(ctx, C.properties, [...units.values()].map((u) => u.propertyId));
  const label = (r: PartyRole) => {
    if (r.entity === "property") return props.get(r.entityId) ? `${props.get(r.entityId)!.number} ${props.get(r.entityId)!.name}` : null;
    if (r.entity === "unit") {
      const u = units.get(r.entityId);
      return u ? `${unitProps.get(u.propertyId)?.name ?? ""} ${u.number}` : null;
    }
    if (r.entity === "deal") return deals.get(r.entityId) ? `${deals.get(r.entityId)!.number} ${deals.get(r.entityId)!.title}` : null;
    return contracts.get(r.entityId) ? `${contracts.get(r.entityId)!.number} ${contracts.get(r.entityId)!.title}` : null;
  };
  const today = todayJst();
  const sorted = [...roles].sort((a, b) => a.entity.localeCompare(b.entity) || a.role.localeCompare(b.role));
  const contractsByParty = ctx.caps.has("contract.read") ? (await findDocs<Contract>(ctx, C.contracts, [["partyIds", "array-contains", p.id]], 100)).filter((c) => !c.archived) : null;
  return (
    <div className="space-y-4">
      <Card title="役割と関連先">
        {sorted.length === 0 ? (
          <StateMessage kind="empty" message="関連先つきの役割はまだありません" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>役割</th><th>関連先</th><th>名称</th><th>期間</th><th>状態</th><th></th></tr></thead>
              <tbody>
                {sorted.map((r) => {
                  const name = label(r);
                  const ended = !!r.to && r.to < today;
                  return (
                    <tr key={r.id}>
                      <td><Badge>{lbl(PARTY_ROLE, r.role)}</Badge></td>
                      <td>{lbl(ROLE_ENTITY, r.entity)}</td>
                      <td>{name ? <Link className="text-primary hover:underline" href={entityHref(r, units)}>{name}</Link> : <span className="text-muted">（閲覧権限なし・または削除済み）</span>}</td>
                      <td>{r.from ?? "—"}〜{r.to ?? ""}</td>
                      <td>{ended ? <Badge>終了</Badge> : <Badge tone="ok">有効</Badge>}</td>
                      <td>
                        {canWrite && (
                          <ActionButton action={removePartyRole} args={{ id: r.id }} label="解除" size="sm" variant="ghost" confirm="この役割を解除しますか？（記録は残ります）" />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {canWrite && <RoleAddForm partyId={p.id} />}
      <Card title="所有物件（所有者・送金配分の設定）">
        {owns.length === 0 ? (
          <p className="text-muted">所有者として登録された物件はありません</p>
        ) : (
          <table className="table">
            <thead><tr><th>物件</th><th>持分</th><th>送金配分</th><th>期間</th></tr></thead>
            <tbody>
              {owns.map((o) => (
                <tr key={o.id}>
                  <td><Link className="text-primary hover:underline" href={`/properties/${o.propertyId}`}>{props.get(o.propertyId)?.name ?? "（閲覧できません）"}</Link></td>
                  <td>{o.share}</td>
                  <td>{o.remitRatio ?? "未設定"}{o.remainderReceiver ? "（端数受取）" : ""}</td>
                  <td>{o.from}〜{o.to ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {contractsByParty && (
        <Card title="契約（当事者として登録されているもの）">
          {contractsByParty.length === 0 ? (
            <p className="text-muted">契約はありません</p>
          ) : (
            <table className="table">
              <thead><tr><th>契約番号</th><th>件名</th><th>状態</th><th>期間</th></tr></thead>
              <tbody>
                {contractsByParty.map((c) => (
                  <tr key={c.id}>
                    <td><Link className="text-primary hover:underline" href={`/contracts/${c.id}`}>{c.number}</Link></td>
                    <td>{c.title}</td>
                    <td><Badge>{labelOf(CONTRACT_STATUSES, c.status)}</Badge></td>
                    <td>{c.start ?? "未定"}〜{c.end ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  );
}

async function DealsTab({ ctx, p, roles }: { ctx: Ctx; p: PartyExt; roles: PartyRole[] }) {
  if (!ctx.caps.has("deal.read")) return <div className="card"><StateMessage kind="forbidden" /></div>;
  const asCustomer = await findDocs<Deal>(ctx, C.deals, [["customerId", "==", p.id]], 200);
  const viaRoles = await getMany<Deal>(ctx, C.deals, roles.filter((r) => r.entity === "deal").map((r) => r.entityId));
  const all = [...new Map([...asCustomer, ...viaRoles.values()].map((d) => [d.id, d])).values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  const names = await staffNameMap(ctx);
  return (
    <Card title="関連する仲介案件" actions={ctx.caps.has("deal.write") && <Link className="btn btn-primary btn-sm" href={`/deals/new?customerId=${p.id}`}>＋ 案件を作成</Link>}>
      {all.length === 0 ? (
        <StateMessage kind="empty" message="関連する案件はありません" />
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>案件番号</th><th>区分</th><th>案件名</th><th>この顧客の立場</th><th>状態</th><th className="num">見込金額</th><th>担当</th><th>次回対応日</th></tr></thead>
            <tbody>
              {all.map((d) => (
                <tr key={d.id}>
                  <td><Link className="text-primary hover:underline" href={`/deals/${d.id}`}>{d.number}</Link></td>
                  <td>{lbl(DEAL_KIND, d.kind)}</td>
                  <td>{d.title}{d.archived && <span className="ml-2"><Badge>アーカイブ</Badge></span>}</td>
                  <td>
                    {[...new Set(roles.filter((r) => r.entity === "deal" && r.entityId === d.id).map((r) => lbl(PARTY_ROLE, r.role)))].join("・") || (d.customerId === p.id ? "顧客" : "—")}
                  </td>
                  <td><Badge tone={dealStatusTone(d.status)}>{labelOf(dealStatuses(d.kind), d.status)}</Badge></td>
                  <td className="num">{yen(d.expectedAmount)}</td>
                  <td>{d.assigneeUid ? names.get(d.assigneeUid) ?? "—" : "未設定"}</td>
                  <td>{d.nextActionDate ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

async function ActivitiesTab({ ctx, partyId, canWrite }: { ctx: Ctx; partyId: string; canWrite: boolean }) {
  const acts = await findDocs<Activity>(ctx, C.activities, [["entity", "==", "party"], ["entityId", "==", partyId]], 300);
  return (
    <div className="space-y-4">
      {canWrite && <ActivityForm entity="party" entityId={partyId} />}
      <ActivityList items={acts} names={await staffNameMap(ctx)} canWrite={canWrite} uid={ctx.uid} />
    </div>
  );
}
