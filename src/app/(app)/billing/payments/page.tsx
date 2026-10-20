import Link from "next/link";
import { requireStaffPage } from "@/lib/server/session";
import { listDocs } from "@/lib/server/repo";
import { listOptsFromSearch, SP } from "@/lib/server/query";
import { C, Payment } from "@/lib/types";
import { DataTable } from "@/components/DataTable";
import { FilterBar } from "@/components/FilterBar";
import { PageHeader, Badge } from "@/components/ui";
import { BillingNav } from "@/components/billing/BillingNav";
import { PAYMENT_STATUS, PAYMENT_SOURCE, DISPOSITION } from "@/lib/labels-billing";
import { lbl, tone, opts } from "@/lib/labels";
import { allocatableOf } from "@/lib/domain/billing";
import { yen } from "@/lib/domain/money";

export const metadata = { title: "入金一覧" };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireStaffPage("payment.read");
  const sp = await searchParams;
  const o = listOptsFromSearch(sp, ["date", "amount", "updatedAt"], ["status", "source"], "date");
  let page;
  let error: string | null = null;
  try {
    page = await listDocs<Payment>(ctx, C.payments, o);
  } catch (e) {
    console.error("[payments.list]", (e as Error).message);
    error = "入金一覧を読み込めませんでした。時間をおいて再読み込みしてください。";
  }
  const canWrite = ctx.caps.has("payment.write");
  return (
    <>
      <PageHeader
        title="入金"
        sub="手入力またはCSVで登録した入金を、請求へ配分（消込）します。配分は担当者が確定します。"
        actions={
          canWrite && (
            <>
              <Link href="/billing/payments/new" className="btn btn-primary">＋ 入金を手入力</Link>
              <Link href="/billing/payments/import" className="btn btn-secondary">CSVから取込み</Link>
            </>
          )
        }
      />
      <BillingNav current="payments" isAdmin={ctx.caps.has("settings.manage")} />
      <FilterBar
        tableId="payments"
        placeholder="名義・参照番号・金額で検索"
        filters={[
          { key: "status", label: "配分状況", options: opts(PAYMENT_STATUS) },
          { key: "source", label: "取込元", options: opts(PAYMENT_SOURCE) },
        ]}
      />
      <DataTable
        tableId="payments"
        csvName="入金一覧"
        loadError={error}
        filtered={o.filtered}
        total={page?.total ?? 0}
        page={page?.page ?? 1}
        pageSize={page?.pageSize ?? 50}
        emptyAction={canWrite && <Link href="/billing/payments/new" className="btn btn-primary">入金を登録</Link>}
        columns={[
          { key: "date", label: "入金日", sortable: true },
          { key: "payerName", label: "名義", primary: true, personal: true },
          { key: "amount", label: "金額", align: "right", sortable: true },
          { key: "allocated", label: "配分済み", align: "right" },
          { key: "unallocated", label: "未配分", align: "right" },
          { key: "status", label: "配分状況" },
          { key: "disposition", label: "過入金の扱い" },
          { key: "source", label: "取込元" },
          { key: "reference", label: "参照番号", hidden: true },
        ]}
        rows={(page?.items ?? []).map((p) => {
          const un = allocatableOf(p);
          return {
            id: p.id,
            href: `/billing/payments/${p.id}`,
            cells: {
              date: p.date,
              payerName: (
                <span>
                  {p.payerName || "（名義なし）"}
                  {p.archived && <span className="ml-2"><Badge>アーカイブ</Badge></span>}
                </span>
              ),
              amount: yen(p.amount),
              allocated: yen(p.allocated),
              unallocated: yen(un),
              status: <Badge tone={tone(PAYMENT_STATUS, p.status)}>{lbl(PAYMENT_STATUS, p.status)}</Badge>,
              disposition: p.unallocatedDisposition ? `${lbl(DISPOSITION, p.unallocatedDisposition.kind)} ${yen(p.unallocatedDisposition.amount)}` : "—",
              source: lbl(PAYMENT_SOURCE, p.source),
              reference: p.reference,
            },
            csv: {
              payerName: p.payerName,
              amount: p.amount,
              allocated: p.allocated,
              unallocated: un,
              status: lbl(PAYMENT_STATUS, p.status),
              disposition: p.unallocatedDisposition ? `${lbl(DISPOSITION, p.unallocatedDisposition.kind)} ${p.unallocatedDisposition.amount}` : "",
              source: lbl(PAYMENT_SOURCE, p.source),
            },
          };
        })}
      />
    </>
  );
}
