import Link from "next/link";
import { requireStaffPage, currentStoreId } from "@/lib/server/session";
import { listDocs, getMany } from "@/lib/server/repo";
import { listOptsFromSearch, storeWhere, SP } from "@/lib/server/query";
import { staffNameMap, staffOptions } from "@/lib/server/lookups";
import { C, Inquiry, Property, Unit } from "@/lib/types";
import { DataTable } from "@/components/DataTable";
import { FilterBar } from "@/components/FilterBar";
import { PageHeader, Badge } from "@/components/ui";
import { SupportNav } from "@/components/support/SupportNav";
import { INQUIRY_STATUS, INQUIRY_CATEGORY, URGENCY, INQUIRY_SOURCE, isInquiryOverdue, lbl, tone, opts } from "@/lib/labels-support";
import { formatDateTimeJst, todayJst } from "@/lib/domain/dates";

export const metadata = { title: "問い合わせ" };

export default async function InquiriesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireStaffPage("repair.read");
  const sp = await searchParams;
  const o = listOptsFromSearch(sp, ["receivedAt", "due", "updatedAt", "number"], ["status", "category", "urgency", "assigneeUid", "source"], "receivedAt");
  o.where = [...(o.where ?? []), ...storeWhere(await currentStoreId(ctx))];
  let page;
  let error: string | null = null;
  try {
    page = await listDocs<Inquiry>(ctx, C.inquiries, o);
  } catch (e) {
    console.error("[inquiries.list]", (e as Error).message);
    error = "問い合わせ一覧を読み込めませんでした。時間をおいて再読み込みしてください。";
  }
  const items = page?.items ?? [];
  const [names, props, units] = await Promise.all([
    staffNameMap(ctx),
    getMany<Property>(ctx, C.properties, items.map((i) => i.propertyId ?? "")),
    getMany<Unit>(ctx, C.units, items.map((i) => i.unitId ?? "")),
  ]);
  const today = todayJst();
  const canWrite = ctx.caps.has("repair.write");

  return (
    <>
      <PageHeader
        title="問い合わせ・修繕"
        sub="入居者・オーナーなどからの問い合わせと対応記録"
        actions={canWrite && <Link href="/support/new" className="btn btn-primary">＋ 問い合わせを登録</Link>}
      />
      <SupportNav current="inquiries" />
      <FilterBar
        tableId="inquiries"
        placeholder="番号・相手・物件名・内容で検索"
        filters={[
          { key: "status", label: "状態", options: opts(INQUIRY_STATUS) },
          { key: "urgency", label: "緊急度", options: opts(URGENCY) },
          { key: "category", label: "分類", options: opts(INQUIRY_CATEGORY) },
          { key: "assigneeUid", label: "担当", options: await staffOptions(ctx) },
          { key: "source", label: "受付経路", options: opts(INQUIRY_SOURCE) },
        ]}
      />
      <DataTable
        tableId="inquiries"
        csvName="問い合わせ一覧"
        loadError={error}
        filtered={o.filtered}
        total={page?.total ?? 0}
        page={page?.page ?? 1}
        pageSize={page?.pageSize ?? 50}
        emptyAction={canWrite && <Link href="/support/new" className="btn btn-primary">問い合わせを登録</Link>}
        columns={[
          { key: "receivedAt", label: "受付日時", sortable: true },
          { key: "party", label: "相手", primary: true, personal: true },
          { key: "target", label: "物件・部屋" },
          { key: "category", label: "分類" },
          { key: "urgency", label: "緊急度" },
          { key: "assignee", label: "担当" },
          { key: "due", label: "期限", sortable: true },
          { key: "status", label: "状態" },
          { key: "number", label: "番号", sortable: true, hidden: true },
        ]}
        rows={items.map((i) => {
          const p = i.propertyId ? props.get(i.propertyId) : null;
          const u = i.unitId ? units.get(i.unitId) : null;
          const overdue = isInquiryOverdue(i, today);
          return {
            id: i.id,
            href: `/support/${i.id}`,
            cells: {
              receivedAt: formatDateTimeJst(i.receivedAt),
              party: (
                <span>
                  {i.partyName ?? "（相手未設定）"}
                  {i.source === "portal" && <span className="ml-2"><Badge tone="info">外部ページ</Badge></span>}
                </span>
              ),
              target: p ? `${p.name}${u ? ` ${u.number}` : ""}` : "—",
              category: lbl(INQUIRY_CATEGORY, i.category),
              urgency: <Badge tone={tone(URGENCY, i.urgency)}>{lbl(URGENCY, i.urgency)}</Badge>,
              assignee: i.assigneeUid ? names.get(i.assigneeUid) ?? "（不明）" : "未設定",
              due: i.due ? (
                <span className="inline-flex flex-wrap items-center gap-1">
                  {i.due}
                  {overdue && <Badge tone="danger">期限超過</Badge>}
                </span>
              ) : "—",
              status: <Badge tone={tone(INQUIRY_STATUS, i.status)}>{lbl(INQUIRY_STATUS, i.status)}</Badge>,
              number: i.number,
            },
            csv: {
              receivedAt: formatDateTimeJst(i.receivedAt),
              party: i.partyName,
              target: p ? `${p.name}${u ? ` ${u.number}` : ""}` : "",
              urgency: lbl(URGENCY, i.urgency),
              due: `${i.due ?? ""}${overdue ? "（期限超過）" : ""}`,
              status: lbl(INQUIRY_STATUS, i.status),
              assignee: i.assigneeUid ? names.get(i.assigneeUid) ?? "" : "",
            },
          };
        })}
      />
    </>
  );
}
