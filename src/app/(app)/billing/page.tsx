import Link from "next/link";
import { requireStaffPage, currentStoreId } from "@/lib/server/session";
import { listDocs, getMany } from "@/lib/server/repo";
import { listOptsFromSearch, storeWhere, SP } from "@/lib/server/query";
import { C, Contract, Invoice } from "@/lib/types";
import { DataTable } from "@/components/DataTable";
import { FilterBar } from "@/components/FilterBar";
import { PageHeader, Badge } from "@/components/ui";
import { BillingNav } from "@/components/billing/BillingNav";
import { INVOICE_STATUS, INVOICE_KIND, PAYMENT_STATE } from "@/lib/labels-billing";
import { lbl, tone, opts } from "@/lib/labels";
import { derivePaymentState, PaymentState } from "@/lib/domain/rules";
import { paymentStateWhere, addPeriod } from "@/lib/domain/billing";
import { todayJst } from "@/lib/domain/dates";
import { yen } from "@/lib/domain/money";
import { confirmInvoices } from "@/lib/server/actions/billing";

export const metadata = { title: "請求一覧" };

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireStaffPage("billing.read");
  const sp = await searchParams;
  const today = todayJst();
  const o = listOptsFromSearch(sp, ["number", "dueDate", "period", "total", "updatedAt"], ["status", "kind", "period"]);
  o.where = [...(o.where ?? []), ...storeWhere(await currentStoreId(ctx))];
  const pay = typeof sp.pay === "string" ? (sp.pay as PaymentState) : null;
  const payWhere = pay ? paymentStateWhere(pay, today) : null;
  if (payWhere) {
    o.where = [...o.where.filter(([f]) => f !== "status"), ...payWhere];
    o.filtered = true;
    // 期限の範囲条件があるときは期限順に並べる
    if (pay !== "paid") {
      o.orderBy = "dueDate";
      o.dir = "asc";
    }
  }
  let page;
  let error: string | null = null;
  try {
    page = await listDocs<Invoice>(ctx, C.invoices, o);
  } catch (e) {
    console.error("[invoices.list]", (e as Error).message);
    error = "請求一覧を読み込めませんでした。時間をおいて再読み込みしてください。";
  }
  const contracts = await getMany<Contract>(ctx, C.contracts, (page?.items ?? []).map((i) => i.contractId ?? ""));
  const canWrite = ctx.caps.has("billing.write");
  const thisMonth = today.slice(0, 7);
  const periods = Array.from({ length: 18 }, (_, i) => addPeriod(thisMonth, 3 - i));

  return (
    <>
      <PageHeader
        title="請求・入金"
        sub="請求の作成・確定・取消・訂正と入金状況を管理します。入金状態は入金配分と期限から自動で判定します。"
        actions={
          canWrite && (
            <>
              <Link href="/billing/new?kind=one_time" className="btn btn-primary">＋ 一時請求</Link>
              <Link href="/billing/new?kind=initial" className="btn btn-secondary">＋ 初期費用請求</Link>
              <Link href="/billing/monthly" className="btn btn-secondary">月次請求を作成</Link>
            </>
          )
        }
      />
      <BillingNav current="invoices" isAdmin={ctx.caps.has("settings.manage")} />
      <FilterBar
        tableId="invoices"
        placeholder="請求番号・請求先・契約番号で検索"
        filters={[
          { key: "status", label: "状態", options: opts(INVOICE_STATUS) },
          { key: "pay", label: "入金状態", options: ["unpaid", "partial", "paid", "overdue"].map((k) => ({ value: k, label: lbl(PAYMENT_STATE, k) })) },
          { key: "period", label: "対象月", options: periods.map((p) => ({ value: p, label: p })) },
          { key: "kind", label: "種別", options: opts(INVOICE_KIND) },
        ]}
      />
      <DataTable
        tableId="invoices"
        csvName="請求一覧"
        loadError={error}
        filtered={o.filtered}
        total={page?.total ?? 0}
        page={page?.page ?? 1}
        pageSize={page?.pageSize ?? 50}
        emptyAction={canWrite && <Link href="/billing/monthly" className="btn btn-primary">月次請求を作成</Link>}
        bulkActions={ctx.caps.has("billing.confirm") ? [{ label: "選択した下書きを確定", run: confirmInvoices, confirm: "選択した下書き請求を確定します。確定後は金額を変更できません（取消・訂正で対応）。" }] : []}
        columns={[
          { key: "number", label: "請求番号", sortable: true },
          { key: "billTo", label: "請求先", primary: true, personal: true },
          { key: "contract", label: "対象契約" },
          { key: "period", label: "対象月", sortable: true },
          { key: "kind", label: "種別" },
          { key: "total", label: "請求額", align: "right", sortable: true },
          { key: "paid", label: "入金済額", align: "right" },
          { key: "remaining", label: "残額", align: "right" },
          { key: "dueDate", label: "期限", sortable: true },
          { key: "payState", label: "入金状態" },
          { key: "status", label: "状態" },
        ]}
        rows={(page?.items ?? []).map((i) => {
          const ps = derivePaymentState(i, today);
          const remaining = i.status === "confirmed" ? Math.max(i.total - i.paid, 0) : null;
          const c = i.contractId ? contracts.get(i.contractId) : null;
          return {
            id: i.id,
            href: `/billing/invoices/${i.id}`,
            cells: {
              number: i.number,
              billTo: i.billToName,
              contract: c ? `${c.number} ${c.title}` : "—",
              period: i.period ?? "—",
              kind: lbl(INVOICE_KIND, i.kind),
              total: yen(i.total),
              paid: i.status === "confirmed" ? yen(i.paid) : "—",
              remaining: remaining === null ? "—" : yen(remaining),
              dueDate: i.dueDate ?? "未設定",
              payState: ps === "n/a" ? "—" : i.total <= 0 ? <Badge>入金不要</Badge> : <Badge tone={tone(PAYMENT_STATE, ps)}>{lbl(PAYMENT_STATE, ps)}</Badge>,
              status: <Badge tone={tone(INVOICE_STATUS, i.status)}>{lbl(INVOICE_STATUS, i.status)}</Badge>,
            },
            csv: {
              total: i.total,
              paid: i.paid,
              remaining,
              contract: c?.number ?? "",
              kind: lbl(INVOICE_KIND, i.kind),
              payState: lbl(PAYMENT_STATE, ps),
              status: lbl(INVOICE_STATUS, i.status),
            },
          };
        })}
      />
    </>
  );
}
