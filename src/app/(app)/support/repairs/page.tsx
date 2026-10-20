import Link from "next/link";
import { requireStaffPage, currentStoreId } from "@/lib/server/session";
import { listDocs, getMany } from "@/lib/server/repo";
import { listOptsFromSearch, storeWhere, SP } from "@/lib/server/query";
import { staffNameMap, staffOptions } from "@/lib/server/lookups";
import { C, Property, Unit, Party } from "@/lib/types";
import { DataTable } from "@/components/DataTable";
import { FilterBar } from "@/components/FilterBar";
import { PageHeader, Badge } from "@/components/ui";
import { SupportNav } from "@/components/support/SupportNav";
import { REPAIR_STATUS, REPAIR_BILLING, REPAIR_PAYMENT, lbl, tone, opts, RepairExt } from "@/lib/labels-support";
import { formatDateTimeJst } from "@/lib/domain/dates";

export const metadata = { title: "修繕案件" };

export default async function RepairsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireStaffPage("repair.read");
  const sp = await searchParams;
  const o = listOptsFromSearch(sp, ["number", "updatedAt", "scheduledDate"], ["status", "assigneeUid", "billingStatus", "paymentStatus"]);
  o.where = [...(o.where ?? []), ...storeWhere(await currentStoreId(ctx))];
  let page;
  let error: string | null = null;
  try {
    page = await listDocs<RepairExt>(ctx, C.repairs, o);
  } catch (e) {
    console.error("[repairs.list]", (e as Error).message);
    error = "修繕案件を読み込めませんでした。時間をおいて再読み込みしてください。";
  }
  const items = page?.items ?? [];
  const [names, props, units, vendors] = await Promise.all([
    staffNameMap(ctx),
    getMany<Property>(ctx, C.properties, items.map((r) => r.propertyId ?? "")),
    getMany<Unit>(ctx, C.units, items.map((r) => r.unitId ?? "")),
    ctx.caps.has("party.read") ? getMany<Party>(ctx, C.parties, items.map((r) => r.vendorPartyId ?? "")) : new Map<string, Party>(),
  ]);
  const canWrite = ctx.caps.has("repair.write");

  return (
    <>
      <PageHeader
        title="問い合わせ・修繕"
        sub="修繕対象・業者・見積・承認・施工・請求を案件単位で管理します"
        actions={canWrite && <Link href="/support/repairs/new" className="btn btn-primary">＋ 修繕案件を登録</Link>}
      />
      <SupportNav current="repairs" />
      <FilterBar
        tableId="repairs"
        placeholder="番号・物件名・設備・症状・業者で検索"
        filters={[
          { key: "status", label: "状態", options: opts(REPAIR_STATUS) },
          { key: "billingStatus", label: "請求", options: opts(REPAIR_BILLING) },
          { key: "paymentStatus", label: "支払", options: opts(REPAIR_PAYMENT) },
          { key: "assigneeUid", label: "担当", options: await staffOptions(ctx) },
        ]}
      />
      <DataTable
        tableId="repairs"
        csvName="修繕案件一覧"
        loadError={error}
        filtered={o.filtered}
        total={page?.total ?? 0}
        page={page?.page ?? 1}
        pageSize={page?.pageSize ?? 50}
        emptyAction={canWrite && <Link href="/support/repairs/new" className="btn btn-primary">修繕案件を登録</Link>}
        columns={[
          { key: "number", label: "番号", sortable: true },
          { key: "target", label: "物件・部屋", primary: true },
          { key: "symptom", label: "対象設備・症状" },
          { key: "vendor", label: "業者" },
          { key: "status", label: "状態" },
          { key: "billing", label: "請求・支払" },
          { key: "scheduledDate", label: "施工予定", sortable: true },
          { key: "assignee", label: "担当" },
          { key: "updatedAt", label: "更新日", sortable: true, hidden: true },
        ]}
        rows={items.map((r) => {
          const p = r.propertyId ? props.get(r.propertyId) : null;
          const u = r.unitId ? units.get(r.unitId) : null;
          const approvedWaitingOrder = r.status === "awaiting_approval" && r.approvalState === "approved";
          return {
            id: r.id,
            href: `/support/repairs/${r.id}`,
            cells: {
              number: r.number,
              target: p ? `${p.name}${u ? ` ${u.number}` : ""}` : "（物件未設定）",
              symptom: `${r.equipment ? `${r.equipment}: ` : ""}${r.symptom}`,
              vendor: r.vendorPartyId ? vendors.get(r.vendorPartyId)?.name ?? "（登録あり）" : "未設定",
              status: (
                <span className="inline-flex flex-wrap gap-1">
                  <Badge tone={approvedWaitingOrder ? "info" : tone(REPAIR_STATUS, r.status)}>{approvedWaitingOrder ? "承認済み・発注記録待ち" : lbl(REPAIR_STATUS, r.status)}</Badge>
                </span>
              ),
              billing: (
                <span className="inline-flex flex-wrap gap-1">
                  <Badge tone={tone(REPAIR_BILLING, r.billingStatus)}>請求: {lbl(REPAIR_BILLING, r.billingStatus)}</Badge>
                  <Badge tone={tone(REPAIR_PAYMENT, r.paymentStatus)}>支払: {lbl(REPAIR_PAYMENT, r.paymentStatus)}</Badge>
                </span>
              ),
              scheduledDate: r.scheduledDate ?? "—",
              assignee: r.assigneeUid ? names.get(r.assigneeUid) ?? "（不明）" : "未設定",
              updatedAt: formatDateTimeJst(r.updatedAt),
            },
            csv: {
              target: p ? `${p.name}${u ? ` ${u.number}` : ""}` : "",
              vendor: r.vendorPartyId ? vendors.get(r.vendorPartyId)?.name ?? "" : "",
              status: lbl(REPAIR_STATUS, r.status),
              billing: `${lbl(REPAIR_BILLING, r.billingStatus)}/${lbl(REPAIR_PAYMENT, r.paymentStatus)}`,
              assignee: r.assigneeUid ? names.get(r.assigneeUid) ?? "" : "",
            },
          };
        })}
      />
    </>
  );
}
