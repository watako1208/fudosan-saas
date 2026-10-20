import Link from "next/link";
import { notFound } from "next/navigation";
import Decimal from "decimal.js";
import { requireStaffPage } from "@/lib/server/session";
import { getDoc, findDocs, getMany, col } from "@/lib/server/repo";
import { tabOf, SP } from "@/lib/server/query";
import { companySettings, staffNameMap } from "@/lib/server/lookups";
import { findRecalcCandidates, isLocked } from "@/lib/server/jobs/billing";
import { confirmInvoice, cancelInvoice, recalcInvoices } from "@/lib/server/actions/billing";
import { C, Allocation, Contract, Invoice, Payment } from "@/lib/types";
import { DetailHeader, Tabs, Card, DL, Badge, StateMessage } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { INVOICE_STATUS, INVOICE_KIND, PAYMENT_STATE, TAX_CATEGORY } from "@/lib/labels-billing";
import { lbl, tone } from "@/lib/labels";
import { derivePaymentState } from "@/lib/domain/rules";
import { computeTotals, yen } from "@/lib/domain/money";
import { formatDateTimeJst, todayJst } from "@/lib/domain/dates";

const TABS = ["lines", "allocations", "history"];

export default async function InvoiceDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const ctx = await requireStaffPage("billing.read");
  const { id } = await params;
  const sp = await searchParams;
  const inv = await getDoc<Invoice>(ctx, C.invoices, id);
  if (!inv) notFound();
  const tab = tabOf(sp, TABS, "lines");
  const today = todayJst();
  const ps = derivePaymentState(inv, today);
  const contract = inv.contractId ? await getDoc<Contract>(ctx, C.contracts, inv.contractId) : null;
  const allocs = (await findDocs<Allocation>(ctx, C.allocations, [["invoiceId", "==", id]], 500)).sort((a, b) => b.allocatedAt.localeCompare(a.allocatedAt));
  const activeAllocs = allocs.filter((a) => !a.reversed);
  const allocTotal = activeAllocs.reduce((s, a) => s + a.amount, 0);
  const locked = await isLocked(ctx, inv.period);
  const canWrite = ctx.caps.has("billing.write");
  const canConfirm = ctx.caps.has("billing.confirm");
  const recalc = inv.kind === "monthly" && inv.status === "draft" ? (await findRecalcCandidates(ctx, inv.period ?? undefined)).find((c) => c.invoice.id === id) : undefined;
  const base = `/billing/invoices/${id}`;
  const remaining = Math.max(inv.total - inv.paid, 0);

  const cancelConfirm =
    inv.status === "draft"
      ? "この下書き請求を取消にします。取消した月額費目は月次作成で再作成されません。"
      : activeAllocs.length
        ? `この請求には ${activeAllocs.length}件・${allocTotal.toLocaleString()}円の入金配分があります。\n取消すると配分も同時に取り消され、入金は未配分額に戻ります。\n取消記録（マイナスの請求）を作成し、元の請求との関係を残します。実行しますか？`
        : "確定済みの請求を取消します。取消記録（マイナスの請求）を作成し、元の請求との関係を残します。実行しますか？";

  return (
    <>
      <DetailHeader
        back={{ href: "/billing", label: "請求一覧" }}
        number={inv.number}
        title={inv.billToName}
        badges={
          <>
            <Badge tone={tone(INVOICE_STATUS, inv.status)}>{lbl(INVOICE_STATUS, inv.status)}</Badge>
            <Badge>{lbl(INVOICE_KIND, inv.kind)}</Badge>
            {ps !== "n/a" && (inv.total > 0 ? <Badge tone={tone(PAYMENT_STATE, ps)}>{lbl(PAYMENT_STATE, ps)}</Badge> : <Badge>入金不要</Badge>)}
            {locked && <Badge>締め済み期間</Badge>}
          </>
        }
        meta={
          <>
            <span>請求額 {yen(inv.total)}</span>
            {inv.status === "confirmed" && <span>入金済 {yen(inv.paid)} / 残額 {yen(remaining)}</span>}
            <span>期限 {inv.dueDate ?? "未設定"}</span>
            <span>対象月 {inv.period ?? "—"}</span>
          </>
        }
        actions={
          <>
            {inv.status === "draft" && canWrite && !locked && <Link href={`${base}/edit`} className="btn btn-secondary">編集</Link>}
            {inv.status === "draft" && canConfirm && !locked && (
              <ActionButton action={confirmInvoice} args={{ id }} label="確定" variant="primary" confirm="この請求を確定します。確定後は金額を変更できません（取消・訂正で対応）。" />
            )}
            {inv.status === "confirmed" && canConfirm && ["monthly", "initial", "one_time", "adjustment"].includes(inv.kind) && (
              <Link href={`${base}/correct`} className="btn btn-secondary">訂正（差額調整）</Link>
            )}
            {inv.status !== "cancelled" && inv.kind !== "cancellation" && canConfirm && !locked && (
              <ActionButton action={cancelInvoice} args={{ id, acknowledge: activeAllocs.length > 0 }} label="取消" variant="danger" prompt="取消の理由を入力してください" confirm={cancelConfirm} />
            )}
            <Link href={`${base}/print`} className="btn btn-secondary">印刷・PDF</Link>
            {inv.status === "confirmed" && (
              <Link href={`/documents/new?entity=invoice&entityId=${id}&docType=invoice`} className="btn btn-secondary">請求書を作成</Link>
            )}
            {inv.status === "confirmed" && inv.paid > 0 && (
              <Link href={`/documents/new?entity=invoice&entityId=${id}&docType=receipt`} className="btn btn-secondary">領収書を作成</Link>
            )}
          </>
        }
      />
      {locked && inv.status === "draft" && (
        <div className="mb-4 rounded-md border border-line bg-surface p-3 text-sm">この請求の対象月は月次締め済みのため、編集・確定・取消はできません。</div>
      )}
      {recalc && (
        <div className="mb-4 rounded-md border border-warn/40 bg-warn-soft p-3 text-sm" role="status">
          <p className="font-semibold text-warn">再計算候補: 契約条件の変更により明細が現在の契約版と一致しません</p>
          <ul className="mt-1 list-disc pl-5">
            {recalc.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
          {canWrite && !locked && (
            <div className="mt-2">
              <ActionButton action={recalcInvoices} args={{ ids: [id] }} label="現在の契約版で再計算" variant="primary" confirm="自動作成の明細を現在の契約版から作り直します（手入力の明細は残します）。" />
            </div>
          )}
        </div>
      )}
      {inv.status === "cancelled" && (
        <div className="mb-4 rounded-md border border-line bg-surface p-3 text-sm">取消済み（理由: {inv.cancelReason ?? "—"}）</div>
      )}
      <Tabs
        base={base}
        current={tab}
        tabs={[
          { key: "lines", label: "明細・税" },
          { key: "allocations", label: "入金配分", count: activeAllocs.length },
          { key: "history", label: "取消・訂正の履歴" },
        ]}
      />
      {tab === "lines" && <LinesTab inv={inv} contract={contract} />}
      {tab === "allocations" && <AllocationsTab allocs={allocs} />}
      {tab === "history" && <HistoryTab inv={inv} />}
    </>
  );
}

async function LinesTab({ inv, contract }: { inv: Invoice; contract: Contract | null }) {
  const ctx = await requireStaffPage("billing.read");
  const settings = await companySettings(ctx.companyId);
  const totals = computeTotals(inv.lines, settings.taxRounding ?? "floor");
  return (
    <div className="space-y-4">
      <Card title="請求情報">
        <DL
          items={[
            ["請求先", <Link key="p" className="text-primary hover:underline" href={`/parties/${inv.billToPartyId}`}>{inv.billToName}</Link>],
            ["対象契約", contract ? <Link key="c" className="text-primary hover:underline" href={`/contracts/${contract.id}`}>{contract.number} {contract.title}</Link> : null],
            ["発行日", inv.issueDate],
            ["支払期限", inv.dueDate],
            ["対象月", inv.period],
            ["確定日時", inv.confirmedAt ? formatDateTimeJst(inv.confirmedAt) : null],
          ]}
        />
      </Card>
      <Card title="明細">
        {inv.lines.length === 0 ? (
          <StateMessage kind="empty" message="明細がありません" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr><th>費目・名称</th><th>期間</th><th className="num">数量</th><th className="num">単価</th><th>税</th><th className="num">金額</th><th>計算根拠</th></tr>
              </thead>
              <tbody>
                {inv.lines.map((l, i) => (
                  <tr key={i}>
                    <td>{l.name}<div className="text-xs text-muted">{l.itemCode}</div></td>
                    <td>{l.from && l.to ? `${l.from}〜${l.to}` : l.period ?? "—"}</td>
                    <td className="num">{l.quantity}</td>
                    <td className="num">{Number(l.unitPrice).toLocaleString("ja-JP", { maximumFractionDigits: 6 })}</td>
                    <td>{lbl(TAX_CATEGORY, l.tax.category)}{l.tax.category === "taxable" ? ` ${new Decimal(l.tax.rate).mul(100).toString()}%（${l.tax.priceMode === "inclusive" ? "税込" : "税抜"}）` : ""}</td>
                    <td className="num">{yen(l.amount)}</td>
                    <td className="text-sm">{l.formula ?? "—"}{l.adjustsInvoiceId && <div><Link className="text-primary hover:underline" href={`/billing/invoices/${l.adjustsInvoiceId}`}>元請求を表示</Link></div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="税率別の内訳（税率ごとに集計して計算）">
        <table className="table max-w-xl">
          <thead><tr><th>区分</th><th className="num">税抜額</th><th className="num">消費税</th><th className="num">税込額</th></tr></thead>
          <tbody>
            {totals.breakdown.map((b) => (
              <tr key={b.key}>
                <td>{lbl(TAX_CATEGORY, b.category)}{b.category === "taxable" ? ` ${new Decimal(b.rate).mul(100).toString()}%` : ""}</td>
                <td className="num">{yen(b.base)}</td>
                <td className="num">{yen(b.tax)}</td>
                <td className="num">{yen(b.total)}</td>
              </tr>
            ))}
            <tr className="font-semibold"><td>合計</td><td className="num">{yen(inv.subtotal)}</td><td className="num">{yen(inv.tax)}</td><td className="num">{yen(inv.total)}</td></tr>
          </tbody>
        </table>
      </Card>
    </div>
  );
}

async function AllocationsTab({ allocs }: { allocs: Allocation[] }) {
  const ctx = await requireStaffPage("billing.read");
  const payments = await getMany<Payment>(ctx, C.payments, allocs.map((a) => a.paymentId));
  const names = await staffNameMap(ctx);
  if (!allocs.length) return <Card><StateMessage kind="empty" message="この請求への入金配分はまだありません" /></Card>;
  return (
    <Card title="入金配分">
      <div className="overflow-x-auto">
        <table className="table">
          <thead><tr><th>入金日</th><th>名義</th><th className="num">配分額</th><th>配分日時・担当</th><th>状態</th></tr></thead>
          <tbody>
            {allocs.map((a) => {
              const p = payments.get(a.paymentId);
              return (
                <tr key={a.id}>
                  <td><Link className="text-primary hover:underline" href={`/billing/payments/${a.paymentId}`}>{p?.date ?? "（入金を表示）"}</Link></td>
                  <td>{p?.payerName ?? "—"}</td>
                  <td className="num">{yen(a.amount)}</td>
                  <td>{formatDateTimeJst(a.allocatedAt)} {names.get(a.allocatedBy) ?? ""}</td>
                  <td>
                    {a.reversed ? <Badge>取消済み</Badge> : <Badge tone="ok">有効</Badge>}
                    {a.settlementId && <span className="ml-1"><Badge tone="info">精算済み</Badge></span>}
                    {a.reversed && a.reason && <div className="text-xs text-muted">理由: {a.reason}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

async function HistoryTab({ inv }: { inv: Invoice }) {
  const ctx = await requireStaffPage("billing.read");
  const related = await findDocs<Invoice>(ctx, C.invoices, [["cancelOf", "==", inv.id]], 100);
  const original = inv.cancelOf ? await getDoc<Invoice>(ctx, C.invoices, inv.cancelOf) : null;
  let logs: { at: string; userName: string; action: string }[] = [];
  try {
    const snap = await col(ctx.companyId, C.auditLogs).where("entity", "==", C.invoices).where("entityId", "==", inv.id).orderBy("at", "desc").limit(50).get();
    logs = snap.docs.map((d) => d.data() as { at: string; userName: string; action: string });
  } catch {
    logs = [];
  }
  const ACTION: Record<string, string> = {
    "invoice.create": "作成（下書き）", "invoice.create_confirm": "作成・確定", "invoice.update": "下書き保存", "invoice.confirm": "確定",
    "invoice.cancel": "取消", "invoice.cancel_draft": "下書きの取消", "invoice.adjustment": "訂正（差額調整を作成）",
    "invoice.monthly_create": "月次作成", "invoice.monthly_append": "月次作成（明細追加）", "invoice.recalc": "再計算",
  };
  return (
    <div className="space-y-4">
      <Card title="関連する請求">
        {!original && related.length === 0 ? (
          <p className="text-muted">取消・訂正の記録はありません</p>
        ) : (
          <table className="table">
            <thead><tr><th>関係</th><th>請求番号</th><th>種別</th><th className="num">金額</th><th>状態</th></tr></thead>
            <tbody>
              {original && (
                <tr>
                  <td>元の請求</td>
                  <td><Link className="text-primary hover:underline" href={`/billing/invoices/${original.id}`}>{original.number}</Link></td>
                  <td>{lbl(INVOICE_KIND, original.kind)}</td>
                  <td className="num">{yen(original.total)}</td>
                  <td><Badge tone={tone(INVOICE_STATUS, original.status)}>{lbl(INVOICE_STATUS, original.status)}</Badge></td>
                </tr>
              )}
              {related.map((r) => (
                <tr key={r.id}>
                  <td>{r.kind === "cancellation" ? "取消記録" : "差額調整"}</td>
                  <td><Link className="text-primary hover:underline" href={`/billing/invoices/${r.id}`}>{r.number}</Link></td>
                  <td>{lbl(INVOICE_KIND, r.kind)}</td>
                  <td className="num">{yen(r.total)}</td>
                  <td><Badge tone={tone(INVOICE_STATUS, r.status)}>{lbl(INVOICE_STATUS, r.status)}</Badge>{r.cancelReason && <div className="text-xs text-muted">理由: {r.cancelReason}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card title="操作記録">
        {logs.length === 0 ? (
          <p className="text-muted">操作記録を表示できません</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {logs.map((l, i) => (
              <li key={i}>{formatDateTimeJst(l.at)} {l.userName}: {ACTION[l.action] ?? l.action}</li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
