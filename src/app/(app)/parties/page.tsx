import Link from "next/link";
import { requireStaffPage, currentStoreId } from "@/lib/server/session";
import { listDocs, Where } from "@/lib/server/repo";
import { listOptsFromSearch, storeWhere, SP } from "@/lib/server/query";
import { staffNameMap, staffOptions } from "@/lib/server/lookups";
import { C, Party } from "@/lib/types";
import { DataTable } from "@/components/DataTable";
import { FilterBar } from "@/components/FilterBar";
import { PageHeader, Badge } from "@/components/ui";
import { PARTY_ROLE, lbl, tone, opts } from "@/lib/labels";
import { PARTY_TYPE, SUPPORT_STATUS } from "@/lib/labels-deals";
import { formatDateTimeJst } from "@/lib/domain/dates";

export const metadata = { title: "顧客一覧" };

export default async function PartiesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireStaffPage("party.read");
  const sp = await searchParams;
  const o = listOptsFromSearch(sp, ["number", "name", "updatedAt"], ["type", "assigneeUid", "supportStatus"]);
  const role = typeof sp.role === "string" && sp.role ? sp.role : null;
  const roleWhere: Where[] = role ? [["roles", "array-contains", role]] : [];
  o.where = [...(o.where ?? []), ...roleWhere, ...storeWhere(await currentStoreId(ctx))];
  if (role) o.filtered = true;
  let page;
  let error: string | null = null;
  try {
    page = await listDocs<Party>(ctx, C.parties, o);
  } catch (e) {
    console.error("[parties.list]", (e as Error).message);
    error = "顧客一覧を読み込めませんでした。時間をおいて再読み込みしてください。";
  }
  const names = await staffNameMap(ctx);
  const canWrite = ctx.caps.has("party.write");

  return (
    <>
      <PageHeader
        title="顧客"
        sub="個人・法人と、貸主・借主・売主・買主などの役割を管理します"
        actions={canWrite && <Link href="/parties/new" className="btn btn-primary">＋ 顧客を登録</Link>}
      />
      <FilterBar
        tableId="parties"
        placeholder="氏名・読み・電話番号・顧客番号で検索"
        filters={[
          { key: "type", label: "区分", options: opts(PARTY_TYPE) },
          { key: "role", label: "役割", options: opts(PARTY_ROLE) },
          { key: "assigneeUid", label: "担当", options: await staffOptions(ctx) },
          { key: "supportStatus", label: "対応状態", options: opts(SUPPORT_STATUS) },
        ]}
      />
      <DataTable
        tableId="parties"
        csvName="顧客一覧"
        loadError={error}
        filtered={o.filtered}
        total={page?.total ?? 0}
        page={page?.page ?? 1}
        pageSize={page?.pageSize ?? 50}
        emptyAction={canWrite && <Link href="/parties/new" className="btn btn-primary">最初の顧客を登録</Link>}
        columns={[
          { key: "number", label: "顧客番号", sortable: true },
          { key: "type", label: "区分" },
          { key: "name", label: "氏名・名称", sortable: true, primary: true, personal: true },
          { key: "kana", label: "読み", personal: true },
          { key: "phone", label: "電話", personal: true },
          { key: "roles", label: "役割" },
          { key: "assignee", label: "担当" },
          { key: "supportStatus", label: "対応状態" },
          { key: "updatedAt", label: "更新日", sortable: true },
        ]}
        rows={(page?.items ?? []).map((p) => ({
          id: p.id,
          href: `/parties/${p.id}`,
          cells: {
            number: p.number,
            type: lbl(PARTY_TYPE, p.type),
            name: (
              <span>
                {p.name}
                {p.archived && <span className="ml-2"><Badge>アーカイブ</Badge></span>}
              </span>
            ),
            kana: p.kana,
            phone: p.phone ?? p.mobile,
            roles: (p.roles ?? []).length ? (
              <span className="flex flex-wrap gap-1">{p.roles.map((r) => <Badge key={r}>{lbl(PARTY_ROLE, r)}</Badge>)}</span>
            ) : "—",
            assignee: p.assigneeUid ? names.get(p.assigneeUid) : "未設定",
            supportStatus: <Badge tone={tone(SUPPORT_STATUS, p.supportStatus)}>{lbl(SUPPORT_STATUS, p.supportStatus ?? "none")}</Badge>,
            updatedAt: formatDateTimeJst(p.updatedAt),
          },
          csv: {
            name: p.name,
            type: lbl(PARTY_TYPE, p.type),
            phone: p.phone ?? p.mobile ?? "",
            roles: (p.roles ?? []).map((r) => lbl(PARTY_ROLE, r)).join("・"),
            assignee: p.assigneeUid ? names.get(p.assigneeUid) ?? "" : "",
            supportStatus: lbl(SUPPORT_STATUS, p.supportStatus ?? "none"),
          },
        }))}
      />
    </>
  );
}
