import Link from "next/link";
import { requireStaffPage } from "@/lib/server/session";
import { listDocs, getMany } from "@/lib/server/repo";
import { listOptsFromSearch, SP } from "@/lib/server/query";
import { C, Party, Settlement } from "@/lib/types";
import { DataTable } from "@/components/DataTable";
import { FilterBar } from "@/components/FilterBar";
import { PageHeader, Badge } from "@/components/ui";
import { SETTLEMENT_STATUS } from "@/lib/labels-billing";
import { lbl, tone, opts } from "@/lib/labels";
import { addPeriod } from "@/lib/domain/billing";
import { todayJst } from "@/lib/domain/dates";
import { yen } from "@/lib/domain/money";

export const metadata = { title: "オーナー精算" };

export default async function SettlementsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireStaffPage("settlement.read");
  const sp = await searchParams;
  const o = listOptsFromSearch(sp, ["number", "period", "updatedAt"], ["status", "period"]);
  let page;
  let error: string | null = null;
  try {
    page = await listDocs<Settlement>(ctx, C.settlements, o);
  } catch (e) {
    console.error("[settlements.list]", (e as Error).message);
    error = "精算一覧を読み込めませんでした。時間をおいて再読み込みしてください。";
  }
  const owners = await getMany<Party>(ctx, C.parties, (page?.items ?? []).map((s) => s.ownerPartyId));
  const canWrite = ctx.caps.has("settlement.write");
  const thisMonth = todayJst().slice(0, 7);
  return (
    <>
      <PageHeader
        title="オーナー精算"
        sub="回収済みの入金だけを対象に、管理料・立替費用・繰越を差し引いて送金予定額を計算します。送金は外部で行い、実行記録を登録します。"
        actions={canWrite && <Link href="/settlements/new" className="btn btn-primary">＋ 精算を作成</Link>}
      />
      <FilterBar
        tableId="settlements"
        placeholder="精算番号・オーナー名で検索"
        filters={[
          { key: "status", label: "状態", options: opts(SETTLEMENT_STATUS) },
          { key: "period", label: "対象月", options: Array.from({ length: 18 }, (_, i) => addPeriod(thisMonth, 1 - i)).map((p) => ({ value: p, label: p })) },
        ]}
      />
      <DataTable
        tableId="settlements"
        csvName="オーナー精算一覧"
        loadError={error}
        filtered={o.filtered}
        total={page?.total ?? 0}
        page={page?.page ?? 1}
        pageSize={page?.pageSize ?? 50}
        emptyAction={canWrite && <Link href="/settlements/new" className="btn btn-primary">最初の精算を作成</Link>}
        columns={[
          { key: "number", label: "精算番号", sortable: true },
          { key: "owner", label: "オーナー", primary: true, personal: true },
          { key: "period", label: "対象月", sortable: true },
          { key: "collected", label: "回収済み", align: "right" },
          { key: "payable", label: "送金予定", align: "right" },
          { key: "remitted", label: "送金記録", align: "right" },
          { key: "diff", label: "差額", align: "right" },
          { key: "status", label: "状態" },
          { key: "published", label: "オーナー公開" },
        ]}
        rows={(page?.items ?? []).map((s) => {
          const payable = s.calc?.payable ?? null;
          const diff = payable === null ? null : payable - s.remitted;
          return {
            id: s.id,
            href: `/settlements/${s.id}`,
            cells: {
              number: s.number,
              owner: owners.get(s.ownerPartyId)?.name ?? "（不明）",
              period: s.period,
              collected: yen(s.calc?.collectedTotal ?? null),
              payable: yen(payable),
              remitted: yen(s.remitted),
              diff: diff === null ? "—" : yen(diff),
              status: <Badge tone={tone(SETTLEMENT_STATUS, s.status)}>{lbl(SETTLEMENT_STATUS, s.status)}</Badge>,
              published: s.publishedToOwner ? "公開中" : "非公開",
            },
            csv: {
              owner: owners.get(s.ownerPartyId)?.name ?? "",
              collected: s.calc?.collectedTotal ?? null,
              payable,
              remitted: s.remitted,
              diff,
              status: lbl(SETTLEMENT_STATUS, s.status),
            },
          };
        })}
      />
    </>
  );
}
