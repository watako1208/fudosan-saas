import Link from "next/link";
import { requireStaffPage, currentStoreId } from "@/lib/server/session";
import { listDocs } from "@/lib/server/repo";
import { listOptsFromSearch, storeWhere, SP } from "@/lib/server/query";
import { staffNameMap, staffOptions } from "@/lib/server/lookups";
import { C, Property } from "@/lib/types";
import { DataTable } from "@/components/DataTable";
import { FilterBar } from "@/components/FilterBar";
import { PageHeader, Badge } from "@/components/ui";
import { PROPERTY_KIND, LISTING_STATUS, lbl, tone, opts } from "@/lib/labels";
import { formatDateTimeJst } from "@/lib/domain/dates";

export const metadata = { title: "物件一覧" };

export default async function PropertiesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireStaffPage("property.read");
  const sp = await searchParams;
  const o = listOptsFromSearch(sp, ["number", "name", "updatedAt"], ["kind", "listingStatus", "assigneeUid"]);
  o.where = [...(o.where ?? []), ...storeWhere(await currentStoreId(ctx))];
  let page;
  let error: string | null = null;
  try {
    page = await listDocs<Property>(ctx, C.properties, o);
  } catch (e) {
    console.error("[properties.list]", (e as Error).message);
    error = "物件一覧を読み込めませんでした。時間をおいて再読み込みしてください。";
  }
  const names = await staffNameMap(ctx);
  const canWrite = ctx.caps.has("property.write");

  return (
    <>
      <PageHeader
        title="物件"
        sub="土地・建物・区画と募集条件を管理します"
        actions={canWrite && <Link href="/properties/new" className="btn btn-primary">＋ 物件を登録</Link>}
      />
      <FilterBar
        tableId="properties"
        placeholder="物件名・住所・物件番号で検索"
        filters={[
          { key: "kind", label: "種別", options: opts(PROPERTY_KIND) },
          { key: "listingStatus", label: "募集状態", options: opts(LISTING_STATUS) },
          { key: "assigneeUid", label: "担当", options: await staffOptions(ctx) },
        ]}
      />
      <DataTable
        tableId="properties"
        csvName="物件一覧"
        loadError={error}
        filtered={o.filtered}
        total={page?.total ?? 0}
        page={page?.page ?? 1}
        pageSize={page?.pageSize ?? 50}
        emptyAction={canWrite && <Link href="/properties/new" className="btn btn-primary">最初の物件を登録</Link>}
        columns={[
          { key: "number", label: "物件番号", sortable: true },
          { key: "name", label: "名称", sortable: true, primary: true },
          { key: "kind", label: "種別" },
          { key: "address", label: "所在地" },
          { key: "dealTypes", label: "賃貸・売買" },
          { key: "listingStatus", label: "募集状態" },
          { key: "price", label: "賃料・価格" },
          { key: "assignee", label: "担当" },
          { key: "updatedAt", label: "更新日", sortable: true },
        ]}
        rows={(page?.items ?? []).map((p) => ({
          id: p.id,
          href: `/properties/${p.id}`,
          cells: {
            number: p.number,
            name: (
              <span>
                {p.name}
                {p.archived && <span className="ml-2"><Badge>アーカイブ</Badge></span>}
              </span>
            ),
            kind: lbl(PROPERTY_KIND, p.kind),
            address: p.address,
            dealTypes: (p.dealTypes ?? []).map((d) => (d === "rent" ? "賃貸" : "売買")).join("・") || "—",
            listingStatus: p.listingStatus ? <Badge tone={tone(LISTING_STATUS, p.listingStatus)}>{lbl(LISTING_STATUS, p.listingStatus)}</Badge> : "—",
            price: p.priceLabel,
            assignee: p.assigneeUid ? names.get(p.assigneeUid) : "未設定",
            updatedAt: formatDateTimeJst(p.updatedAt),
          },
          csv: {
            name: p.name,
            dealTypes: (p.dealTypes ?? []).join("/"),
            listingStatus: lbl(LISTING_STATUS, p.listingStatus),
            assignee: p.assigneeUid ? names.get(p.assigneeUid) ?? "" : "",
          },
        }))}
      />
    </>
  );
}
