import Link from "next/link";
import { requireStaffPage, currentStoreId, canAccessStore, Ctx } from "@/lib/server/session";
import { listDocs, findDocs, getMany, Where } from "@/lib/server/repo";
import { listOptsFromSearch, storeWhere, SP } from "@/lib/server/query";
import { staffNameMap, staffOptions } from "@/lib/server/lookups";
import { C, Deal, Party, Property } from "@/lib/types";
import { DataTable } from "@/components/DataTable";
import { FilterBar } from "@/components/FilterBar";
import { PageHeader, Badge, StateMessage } from "@/components/ui";
import { DealStatusControl } from "@/components/deals/DealStatusControl";
import { lbl, opts, fromPairs } from "@/lib/labels";
import { DEAL_KIND, DEAL_SIDE, dealStatuses, dealStatusTone } from "@/lib/labels-deals";
import { RENTAL_DEAL_STATUSES, SALE_DEAL_STATUSES, labelOf } from "@/lib/domain/rules";
import { todayJst } from "@/lib/domain/dates";
import { yen } from "@/lib/domain/money";

export const metadata = { title: "仲介案件" };

const g = (sp: SP, k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");

export default async function DealsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireStaffPage("deal.read");
  const sp = await searchParams;
  const view = g(sp, "view") === "kanban" ? "kanban" : "table";
  const canWrite = ctx.caps.has("deal.write");
  const kindForKanban = g(sp, "kind") === "sale" ? "sale" : "rental";
  const statusOptions = [...fromPairs(RENTAL_DEAL_STATUSES).map((o) => ({ ...o, label: `賃貸: ${o.label}` })), ...fromPairs(SALE_DEAL_STATUSES).map((o) => ({ ...o, label: `売買: ${o.label}` }))];
  const toggle = (v: "table" | "kanban") => {
    const p = new URLSearchParams();
    for (const [k, val] of Object.entries(sp)) if (typeof val === "string" && k !== "view" && k !== "page") p.set(k, val);
    if (v === "kanban") p.set("view", "kanban");
    return `/deals?${p.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="仲介案件"
        sub="賃貸・売買の仲介案件を、表または進行状態別の列で管理します"
        actions={
          <>
            <div className="inline-flex rounded-md border border-line bg-surface p-0.5" role="group" aria-label="表示切替">
              <Link href={toggle("table")} className={`btn btn-sm ${view === "table" ? "btn-primary" : "btn-ghost"}`} aria-current={view === "table" ? "page" : undefined}>表</Link>
              <Link href={toggle("kanban")} className={`btn btn-sm ${view === "kanban" ? "btn-primary" : "btn-ghost"}`} aria-current={view === "kanban" ? "page" : undefined}>進行状態別</Link>
            </div>
            {canWrite && <Link href="/deals/new" className="btn btn-primary">＋ 案件を登録</Link>}
          </>
        }
      />
      <FilterBar
        tableId="deals"
        placeholder="案件名・案件番号・顧客名・物件名で検索"
        filters={[
          { key: "kind", label: "区分", options: opts(DEAL_KIND) },
          ...(view === "table" ? [{ key: "status", label: "進行状態", options: statusOptions }] : []),
          { key: "assigneeUid", label: "担当", options: await staffOptions(ctx) },
        ]}
      />
      {view === "table" ? <TableView ctx={ctx} sp={sp} canWrite={canWrite} /> : <KanbanView ctx={ctx} sp={sp} kind={kindForKanban} canWrite={canWrite} />}
    </>
  );
}

async function lookups(ctx: Ctx, deals: Deal[]) {
  const [parties, props, names] = await Promise.all([
    getMany<Party>(ctx, C.parties, deals.map((d) => d.customerId ?? "")),
    getMany<Property>(ctx, C.properties, deals.flatMap((d) => (d.propertyIds ?? []).slice(0, 3))),
    staffNameMap(ctx),
  ]);
  return { parties, props, names };
}

async function TableView({ ctx, sp, canWrite }: { ctx: Ctx; sp: SP; canWrite: boolean }) {
  const o = listOptsFromSearch(sp, ["number", "updatedAt", "nextActionDate", "expectedAmount"], ["kind", "status", "assigneeUid"]);
  o.where = [...(o.where ?? []), ...storeWhere(await currentStoreId(ctx))];
  let page;
  let error: string | null = null;
  try {
    page = await listDocs<Deal>(ctx, C.deals, o);
  } catch (e) {
    console.error("[deals.list]", (e as Error).message);
    error = "案件一覧を読み込めませんでした。時間をおいて再読み込みしてください。";
  }
  const items = page?.items ?? [];
  const { parties, props, names } = await lookups(ctx, items);
  const today = todayJst();
  return (
    <DataTable
      tableId="deals"
      csvName="仲介案件一覧"
      loadError={error}
      filtered={o.filtered}
      total={page?.total ?? 0}
      page={page?.page ?? 1}
      pageSize={page?.pageSize ?? 50}
      emptyAction={canWrite && <Link href="/deals/new" className="btn btn-primary">最初の案件を登録</Link>}
      columns={[
        { key: "number", label: "案件番号", sortable: true },
        { key: "kind", label: "賃貸・売買" },
        { key: "title", label: "案件名", primary: true },
        { key: "customer", label: "顧客", personal: true },
        { key: "properties", label: "対象物件" },
        { key: "assignee", label: "担当" },
        { key: "status", label: "進行状態" },
        { key: "expectedAmount", label: "見込金額", sortable: true, align: "right" },
        { key: "nextActionDate", label: "次回対応日", sortable: true },
      ]}
      rows={items.map((d) => {
        const overdue = !!d.nextActionDate && d.nextActionDate < today && !["won", "lost", "delivered", "closed"].includes(d.status);
        return {
          id: d.id,
          href: `/deals/${d.id}`,
          cells: {
            number: d.number,
            kind: `${lbl(DEAL_KIND, d.kind)}${d.side ? `（${lbl(DEAL_SIDE, d.side)}）` : ""}`,
            title: <span>{d.title}{d.archived && <span className="ml-2"><Badge>アーカイブ</Badge></span>}</span>,
            customer: d.customerId ? parties.get(d.customerId)?.name ?? "—" : "未設定",
            properties: (d.propertyIds ?? []).length ? `${(d.propertyIds ?? []).slice(0, 3).map((id) => props.get(id)?.name ?? "—").join("、")}${d.propertyIds.length > 3 ? ` 他${d.propertyIds.length - 3}件` : ""}` : "—",
            assignee: d.assigneeUid ? names.get(d.assigneeUid) ?? "—" : "未設定",
            status: <Badge tone={dealStatusTone(d.status)}>{labelOf(dealStatuses(d.kind), d.status)}</Badge>,
            expectedAmount: yen(d.expectedAmount),
            nextActionDate: d.nextActionDate ? (
              <span>{d.nextActionDate}{overdue && <span className="ml-1"><Badge tone="danger">期限超過</Badge></span>}</span>
            ) : "—",
          },
          csv: {
            kind: lbl(DEAL_KIND, d.kind),
            title: d.title,
            customer: d.customerId ? parties.get(d.customerId)?.name ?? "" : "",
            status: labelOf(dealStatuses(d.kind), d.status),
            expectedAmount: d.expectedAmount,
            nextActionDate: d.nextActionDate,
            assignee: d.assigneeUid ? names.get(d.assigneeUid) ?? "" : "",
          },
        };
      })}
    />
  );
}

async function KanbanView({ ctx, sp, kind, canWrite }: { ctx: Ctx; sp: SP; kind: "rental" | "sale"; canWrite: boolean }) {
  const where: Where[] = [["kind", "==", kind], ["archived", "==", false]];
  const assignee = g(sp, "assigneeUid");
  if (assignee) where.push(["assigneeUid", "==", assignee]);
  const store = await currentStoreId(ctx);
  let deals: Deal[] = [];
  let error = false;
  try {
    deals = await findDocs<Deal>(ctx, C.deals, where, 500);
  } catch (e) {
    console.error("[deals.kanban]", (e as Error).message);
    error = true;
  }
  const q = g(sp, "q").normalize("NFKC").toLowerCase();
  deals = deals.filter((d) => (!store || d.storeId === store) && (!q || `${d.number} ${d.title}`.normalize("NFKC").toLowerCase().includes(q)));
  deals.sort((a, b) => (a.nextActionDate ?? "9999") < (b.nextActionDate ?? "9999") ? -1 : 1);
  const { parties, names } = await lookups(ctx, deals);
  const statuses = dealStatuses(kind);
  const today = todayJst();
  const kindHref = (k: string) => {
    const p = new URLSearchParams();
    for (const [key, val] of Object.entries(sp)) if (typeof val === "string" && key !== "kind") p.set(key, val);
    p.set("kind", k);
    return `/deals?${p.toString()}`;
  };
  if (error) return <div className="card"><StateMessage kind="error" message="案件を読み込めませんでした。時間をおいて再読み込みしてください。" /></div>;
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-sm">
        <span className="text-muted">列の区分:</span>
        <Link href={kindHref("rental")} className={`btn btn-sm ${kind === "rental" ? "btn-primary" : "btn-secondary"}`}>賃貸</Link>
        <Link href={kindHref("sale")} className={`btn btn-sm ${kind === "sale" ? "btn-primary" : "btn-secondary"}`}>売買</Link>
        <span className="ml-auto text-muted">全 {deals.length} 件{deals.length >= 500 ? "（上限500件まで表示）" : ""}</span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-4" role="list" aria-label="進行状態別の案件">
        {statuses.map(([key, label]) => {
          const col = deals.filter((d) => d.status === key);
          return (
            <section key={key} className="w-72 shrink-0 rounded-lg border border-line bg-[#eef0f3]" role="listitem" aria-label={label}>
              <h2 className="flex items-center justify-between px-3 py-2 text-sm">
                <Badge tone={dealStatusTone(key)}>{label}</Badge>
                <span className="text-muted">{col.length}件</span>
              </h2>
              <ul className="space-y-2 px-2 pb-2">
                {col.length === 0 && <li className="px-2 py-3 text-center text-xs text-muted">案件なし</li>}
                {col.map((d) => {
                  const overdue = !!d.nextActionDate && d.nextActionDate < today;
                  return (
                    <li key={d.id} className="rounded-md border border-line bg-surface p-2.5 text-sm shadow-sm">
                      <Link href={`/deals/${d.id}`} className="block">
                        <span className="text-xs text-muted">{d.number}{d.side ? ` ・${lbl(DEAL_SIDE, d.side)}` : ""}</span>
                        <span className="block font-semibold break-words text-primary hover:underline">{d.title}</span>
                        <span className="block text-xs">{d.customerId ? parties.get(d.customerId)?.name ?? "—" : "顧客未設定"}</span>
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                        <span>担当: {d.assigneeUid ? names.get(d.assigneeUid) ?? "—" : "未設定"}</span>
                        <span>{yen(d.expectedAmount)}</span>
                        {d.nextActionDate && <span>次回 {d.nextActionDate}</span>}
                        {overdue && <Badge tone="danger">期限超過</Badge>}
                      </div>
                      {canWrite && canAccessStore(ctx, d.storeId) && (
                        <div className="mt-2 border-t border-line pt-2">
                          <DealStatusControl id={d.id} status={d.status} statuses={statuses} compact />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
