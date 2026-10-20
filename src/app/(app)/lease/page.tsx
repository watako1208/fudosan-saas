import { requireStaffPage, currentStoreId } from "@/lib/server/session";
import { listDocs, getMany } from "@/lib/server/repo";
import { listOptsFromSearch, storeWhere, tabOf, SP } from "@/lib/server/query";
import { staffNameMap } from "@/lib/server/lookups";
import { runRenewalExtraction } from "@/lib/server/actions/lease";
import { C, Renewal, Moveout, Unit, Property } from "@/lib/types";
import { DataTable } from "@/components/DataTable";
import { FilterBar } from "@/components/FilterBar";
import { PageHeader, Badge, Tabs } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { lbl, tone, opts } from "@/lib/labels";
import { RENEWAL_STATUS, RENEWAL_ANSWER, MOVEOUT_STATUS } from "@/lib/labels-contracts";
import { todayJst, compare } from "@/lib/domain/dates";

export const metadata = { title: "更新・退去" };

type WithContract = { contractNumber?: string; contractTitle?: string; assigneeUid?: string | null };

export default async function LeasePage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireStaffPage("lease.read");
  const sp = await searchParams;
  const tab = tabOf(sp, ["renewals", "moveouts"], "renewals");
  const canWrite = ctx.caps.has("lease.write");
  const storeW = storeWhere(await currentStoreId(ctx));
  const today = todayJst();

  return (
    <>
      <PageHeader
        title="更新・退去"
        sub="契約満了が近い賃貸契約の更新手続きと、解約・退去精算を管理します"
        actions={
          canWrite &&
          tab === "renewals" && (
            <ActionButton action={runRenewalExtraction} label="対象を抽出" variant="primary" confirm="今日から120日以内に満了する賃貸契約を更新対象として抽出します（抽出済みの契約は重複作成しません）。" />
          )
        }
      />
      <Tabs base="/lease" current={tab} tabs={[{ key: "renewals", label: "更新管理" }, { key: "moveouts", label: "解約・退去精算" }]} />
      {tab === "renewals" ? <Renewals sp={sp} ctx={ctx} storeW={storeW} today={today} /> : <Moveouts sp={sp} ctx={ctx} storeW={storeW} />}
    </>
  );
}

async function Renewals({ sp, ctx, storeW, today }: { sp: SP; ctx: Awaited<ReturnType<typeof requireStaffPage>>; storeW: ReturnType<typeof storeWhere>; today: string }) {
  const o = listOptsFromSearch(sp, ["expiresOn", "noticeDeadline", "updatedAt"], ["status", "answer"], "expiresOn");
  if (!sp.dir) o.dir = "asc";
  o.where = [...(o.where ?? []), ...storeW];
  let page;
  let error: string | null = null;
  try {
    page = await listDocs<Renewal & WithContract>(ctx, C.renewals, o);
  } catch (e) {
    console.error("[renewals.list]", (e as Error).message);
    error = "更新対象を読み込めませんでした。時間をおいて再読み込みしてください。";
  }
  const items = page?.items ?? [];
  const names = await staffNameMap(ctx);
  const units = await getMany<Unit>(ctx, C.units, items.map((r) => r.unitId ?? ""));
  const props = await getMany<Property>(ctx, C.properties, [...units.values()].map((u) => u.propertyId));
  return (
    <>
      <FilterBar
        tableId="renewals"
        placeholder="契約番号・件名で検索"
        filters={[
          { key: "status", label: "状態", options: opts(RENEWAL_STATUS) },
          { key: "answer", label: "回答", options: opts(RENEWAL_ANSWER) },
        ]}
      />
      <DataTable
        tableId="renewals"
        csvName="更新対象"
        loadError={error}
        filtered={o.filtered}
        total={page?.total ?? 0}
        page={page?.page ?? 1}
        pageSize={page?.pageSize ?? 50}
        columns={[
          { key: "contract", label: "契約", primary: true },
          { key: "unit", label: "物件・部屋" },
          { key: "expiresOn", label: "満了日", sortable: true },
          { key: "noticeDeadline", label: "案内期限", sortable: true },
          { key: "answer", label: "回答" },
          { key: "status", label: "手続き状態" },
          { key: "assignee", label: "担当" },
        ]}
        rows={items.map((r) => {
          const u = r.unitId ? units.get(r.unitId) : null;
          const overdue = r.noticeDeadline && ["extracted"].includes(r.status) && compare(r.noticeDeadline, today) < 0;
          return {
            id: r.id,
            href: `/lease/renewals/${r.id}`,
            cells: {
              contract: `${r.contractNumber ?? ""} ${r.contractTitle ?? ""}`.trim() || r.contractId,
              unit: u ? `${props.get(u.propertyId)?.name ?? ""} ${u.number}` : "—",
              expiresOn: r.expiresOn,
              noticeDeadline: r.noticeDeadline ? (overdue ? <span><Badge tone="danger">期限超過</Badge> {r.noticeDeadline}</span> : r.noticeDeadline) : "ルール未設定",
              answer: <Badge tone={tone(RENEWAL_ANSWER, r.answer)}>{lbl(RENEWAL_ANSWER, r.answer)}</Badge>,
              status: <Badge tone={tone(RENEWAL_STATUS, r.status)}>{lbl(RENEWAL_STATUS, r.status)}</Badge>,
              assignee: r.assigneeUid ? names.get(r.assigneeUid) ?? "（不明）" : "未設定",
            },
            csv: { contract: `${r.contractNumber ?? ""} ${r.contractTitle ?? ""}`, noticeDeadline: r.noticeDeadline ?? "", answer: lbl(RENEWAL_ANSWER, r.answer), status: lbl(RENEWAL_STATUS, r.status) },
          };
        })}
      />
      <p className="help mt-2">更新対象は毎日自動で抽出します（満了日の120日前から）。抽出されただけでは契約は更新されません。</p>
    </>
  );
}

async function Moveouts({ sp, ctx, storeW }: { sp: SP; ctx: Awaited<ReturnType<typeof requireStaffPage>>; storeW: ReturnType<typeof storeWhere> }) {
  const o = listOptsFromSearch(sp, ["requestedAt", "confirmedDate", "updatedAt"], ["status"]);
  o.where = [...(o.where ?? []), ...storeW];
  let page;
  let error: string | null = null;
  try {
    page = await listDocs<Moveout & WithContract>(ctx, C.moveouts, o);
  } catch (e) {
    console.error("[moveouts.list]", (e as Error).message);
    error = "解約・退去を読み込めませんでした。時間をおいて再読み込みしてください。";
  }
  const items = page?.items ?? [];
  const units = await getMany<Unit>(ctx, C.units, items.map((r) => r.unitId ?? ""));
  const props = await getMany<Property>(ctx, C.properties, [...units.values()].map((u) => u.propertyId));
  return (
    <>
      <FilterBar tableId="moveouts" placeholder="契約番号・件名で検索" filters={[{ key: "status", label: "状態", options: opts(MOVEOUT_STATUS) }]} />
      <DataTable
        tableId="moveouts"
        csvName="解約退去"
        loadError={error}
        filtered={o.filtered}
        total={page?.total ?? 0}
        page={page?.page ?? 1}
        pageSize={page?.pageSize ?? 50}
        columns={[
          { key: "contract", label: "契約", primary: true },
          { key: "unit", label: "物件・部屋" },
          { key: "requestedAt", label: "申出日", sortable: true },
          { key: "desiredDate", label: "希望日" },
          { key: "confirmedDate", label: "確認済み解約日", sortable: true },
          { key: "status", label: "状態" },
        ]}
        rows={items.map((m) => {
          const u = m.unitId ? units.get(m.unitId) : null;
          return {
            id: m.id,
            href: `/lease/moveouts/${m.id}`,
            cells: {
              contract: `${m.contractNumber ?? ""} ${m.contractTitle ?? ""}`.trim() || m.contractId,
              unit: u ? `${props.get(u.propertyId)?.name ?? ""} ${u.number}` : "—",
              requestedAt: m.requestedAt,
              desiredDate: m.desiredDate ?? "—",
              confirmedDate: m.confirmedDate ?? "未確定",
              status: <Badge tone={tone(MOVEOUT_STATUS, m.status)}>{lbl(MOVEOUT_STATUS, m.status)}</Badge>,
            },
            csv: { contract: `${m.contractNumber ?? ""} ${m.contractTitle ?? ""}`, confirmedDate: m.confirmedDate ?? "", status: lbl(MOVEOUT_STATUS, m.status) },
          };
        })}
      />
      <p className="help mt-2">解約・退去は契約詳細の「解約・退去を登録」から登録します。</p>
    </>
  );
}
