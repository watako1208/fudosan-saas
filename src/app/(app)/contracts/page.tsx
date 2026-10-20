import Link from "next/link";
import { requireStaffPage, currentStoreId } from "@/lib/server/session";
import { listDocs, getMany } from "@/lib/server/repo";
import { listOptsFromSearch, storeWhere, SP } from "@/lib/server/query";
import { staffNameMap, staffOptions } from "@/lib/server/lookups";
import { C, Contract, ContractVersion, Unit, Property } from "@/lib/types";
import { DataTable } from "@/components/DataTable";
import { FilterBar } from "@/components/FilterBar";
import { PageHeader, Badge } from "@/components/ui";
import { lbl, tone, opts } from "@/lib/labels";
import { CONTRACT_KIND, CONTRACT_STATUS } from "@/lib/labels-contracts";

export const metadata = { title: "契約一覧" };

export default async function ContractsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireStaffPage("contract.read");
  const sp = await searchParams;
  const o = listOptsFromSearch(sp, ["number", "start", "end", "updatedAt"], ["kind", "status", "assigneeUid"]);
  o.where = [...(o.where ?? []), ...storeWhere(await currentStoreId(ctx))];
  let page;
  let error: string | null = null;
  try {
    page = await listDocs<Contract>(ctx, C.contracts, o);
  } catch (e) {
    console.error("[contracts.list]", (e as Error).message);
    error = "契約一覧を読み込めませんでした。時間をおいて再読み込みしてください。";
  }
  const items = page?.items ?? [];
  const names = await staffNameMap(ctx);
  const units = await getMany<Unit>(ctx, C.units, items.map((c) => c.unitId ?? ""));
  const props = await getMany<Property>(ctx, C.properties, [...items.flatMap((c) => c.propertyIds ?? []), ...[...units.values()].map((u) => u.propertyId)]);
  // 当事者名は現行版のスナップショット（契約時点の氏名）を表示する
  const versions = await getMany<ContractVersion>(ctx, C.contractVersions, items.map((c) => c.currentVersionId ?? ""));
  const canWrite = ctx.caps.has("contract.write");

  const target = (c: Contract) => {
    if (c.unitId) {
      const u = units.get(c.unitId);
      const p = u ? props.get(u.propertyId) : null;
      return `${p?.name ?? ""} ${u?.number ?? ""}`.trim() || "—";
    }
    return (c.propertyIds ?? []).map((id) => props.get(id)?.name ?? "（不明）").join("・") || "—";
  };
  const partiesOf = (c: Contract) =>
    (versions.get(c.currentVersionId ?? "")?.parties ?? [])
      .filter((p) => ["lessor", "lessee", "seller", "buyer"].includes(p.role))
      .map((p) => p.name)
      .join("、");

  return (
    <>
      <PageHeader
        title="契約"
        sub="賃貸借・売買の契約条件、社内承認、締結記録を管理します"
        actions={
          canWrite && (
            <>
              <Link href="/contracts/new?kind=lease" className="btn btn-primary">＋ 賃貸契約</Link>
              <Link href="/contracts/new?kind=sale" className="btn btn-secondary">＋ 売買契約</Link>
            </>
          )
        }
      />
      <FilterBar
        tableId="contracts"
        placeholder="契約番号・件名・当事者名で検索"
        filters={[
          { key: "kind", label: "種類", options: opts(CONTRACT_KIND).filter((x) => ["lease", "sale"].includes(x.value)) },
          { key: "status", label: "状態", options: opts(CONTRACT_STATUS) },
          { key: "assigneeUid", label: "担当", options: await staffOptions(ctx) },
        ]}
      />
      <DataTable
        tableId="contracts"
        csvName="契約一覧"
        loadError={error}
        filtered={o.filtered}
        total={page?.total ?? 0}
        page={page?.page ?? 1}
        pageSize={page?.pageSize ?? 50}
        emptyAction={canWrite && <Link href="/contracts/new?kind=lease" className="btn btn-primary">最初の契約を作成</Link>}
        columns={[
          { key: "number", label: "契約番号", sortable: true },
          { key: "kind", label: "種類" },
          { key: "title", label: "件名", primary: true },
          { key: "target", label: "物件・部屋" },
          { key: "parties", label: "当事者", personal: true },
          { key: "status", label: "状態" },
          { key: "start", label: "開始日", sortable: true },
          { key: "end", label: "終了日", sortable: true },
          { key: "assignee", label: "担当" },
        ]}
        rows={items.map((c) => ({
          id: c.id,
          href: `/contracts/${c.id}`,
          cells: {
            number: c.number,
            kind: lbl(CONTRACT_KIND, c.kind),
            title: (
              <span>
                {c.title}
                {c.archived && <span className="ml-2"><Badge>アーカイブ</Badge></span>}
              </span>
            ),
            target: target(c),
            parties: partiesOf(c) || "—",
            status: <Badge tone={tone(CONTRACT_STATUS, c.status)}>{lbl(CONTRACT_STATUS, c.status)}</Badge>,
            start: c.start ?? "未定",
            end: c.end ?? (c.kind === "lease" ? "定めなし・未定" : "—"),
            assignee: c.assigneeUid ? names.get(c.assigneeUid) ?? "（不明）" : "未設定",
          },
          csv: {
            title: c.title,
            status: lbl(CONTRACT_STATUS, c.status),
            assignee: c.assigneeUid ? names.get(c.assigneeUid) ?? "" : "",
          },
        }))}
      />
    </>
  );
}
