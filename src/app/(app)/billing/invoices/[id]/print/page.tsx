import { notFound } from "next/navigation";
import Decimal from "decimal.js";
import { requireStaffPage } from "@/lib/server/session";
import { getDoc } from "@/lib/server/repo";
import { companyName, companySettings } from "@/lib/server/lookups";
import { C, Contract, Invoice } from "@/lib/types";
import { PrintView } from "@/components/billing/PrintView";
import { computeTotals, yen } from "@/lib/domain/money";
import { TAX_CATEGORY, INVOICE_KIND } from "@/lib/labels-billing";
import { lbl } from "@/lib/labels";

export const metadata = { title: "請求書（印刷）" };

export default async function InvoicePrint({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaffPage("billing.read");
  const { id } = await params;
  const inv = await getDoc<Invoice>(ctx, C.invoices, id);
  if (!inv) notFound();
  const contract = inv.contractId ? await getDoc<Contract>(ctx, C.contracts, inv.contractId) : null;
  const settings = await companySettings(ctx.companyId);
  const totals = computeTotals(inv.lines, settings.taxRounding ?? "floor");
  const title = inv.kind === "cancellation" ? "請求取消通知" : inv.kind === "adjustment" ? "請求書（差額調整）" : "請求書";
  return (
    <PrintView backHref={`/billing/invoices/${id}`}>
      {inv.status !== "confirmed" && (
        <p style={{ border: "2px solid #b91c1c", color: "#b91c1c", padding: "4px 8px", fontWeight: 700, marginBottom: 8 }}>
          {inv.status === "draft" ? "下書き（未確定）— 正式な請求書ではありません" : "取消済みの請求です"}
        </p>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div>
          <h1 style={{ fontSize: "20pt", fontWeight: 700, letterSpacing: "0.3em" }}>{title}</h1>
          <p style={{ marginTop: 16, fontSize: "13pt", borderBottom: "1px solid #333", paddingBottom: 2 }}>{inv.billToName} 様</p>
          {contract && <p style={{ marginTop: 4 }}>対象契約: {contract.number} {contract.title}</p>}
        </div>
        <div style={{ textAlign: "right" }}>
          <p>請求番号: {inv.number}</p>
          <p>発行日: {inv.issueDate}</p>
          {inv.period && <p>対象月: {inv.period}</p>}
          <p style={{ marginTop: 8, fontWeight: 700 }}>{await companyName(ctx.companyId)}</p>
        </div>
      </div>
      <table style={{ marginTop: 16 }}>
        <tbody>
          <tr>
            <th style={{ width: "30%" }}>ご請求金額（税込）</th>
            <td className="r" style={{ fontSize: "15pt", fontWeight: 700 }}>{yen(inv.total)}</td>
          </tr>
          <tr>
            <th>お支払期限</th>
            <td>{inv.dueDate ?? "—"}</td>
          </tr>
        </tbody>
      </table>
      <table style={{ marginTop: 16 }}>
        <thead>
          <tr><th>品目</th><th>期間</th><th className="r">数量</th><th className="r">単価</th><th>税区分</th><th className="r">金額</th></tr>
        </thead>
        <tbody>
          {inv.lines.map((l, i) => (
            <tr key={i}>
              <td>{l.name}{l.formula && <div style={{ fontSize: "8.5pt", color: "#555" }}>{l.formula}</div>}</td>
              <td>{l.from && l.to ? `${l.from}〜${l.to}` : l.period ?? ""}</td>
              <td className="r">{l.quantity}</td>
              <td className="r">{Number(l.unitPrice).toLocaleString("ja-JP", { maximumFractionDigits: 6 })}</td>
              <td>{lbl(TAX_CATEGORY, l.tax.category)}{l.tax.category === "taxable" ? ` ${new Decimal(l.tax.rate).mul(100).toString()}%${l.tax.priceMode === "inclusive" ? "（税込）" : ""}` : ""}</td>
              <td className="r">{yen(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table style={{ marginTop: 12, width: "60%", marginLeft: "auto" }}>
        <thead><tr><th>税率区分</th><th className="r">対象額（税抜）</th><th className="r">消費税</th></tr></thead>
        <tbody>
          {totals.breakdown.map((b) => (
            <tr key={b.key}>
              <td>{lbl(TAX_CATEGORY, b.category)}{b.category === "taxable" ? ` ${new Decimal(b.rate).mul(100).toString()}%` : ""}</td>
              <td className="r">{yen(b.base)}</td>
              <td className="r">{yen(b.tax)}</td>
            </tr>
          ))}
          <tr><th>小計（税抜）</th><td className="r" colSpan={2}>{yen(inv.subtotal)}</td></tr>
          <tr><th>消費税</th><td className="r" colSpan={2}>{yen(inv.tax)}</td></tr>
          <tr><th>合計（税込）</th><td className="r" colSpan={2} style={{ fontWeight: 700 }}>{yen(inv.total)}</td></tr>
          {inv.status === "confirmed" && inv.paid > 0 && (
            <>
              <tr><th>入金済額</th><td className="r" colSpan={2}>{yen(inv.paid)}</td></tr>
              <tr><th>残額</th><td className="r" colSpan={2}>{yen(Math.max(inv.total - inv.paid, 0))}</td></tr>
            </>
          )}
        </tbody>
      </table>
      <p style={{ marginTop: 12, fontSize: "9pt", color: "#555" }}>種別: {lbl(INVOICE_KIND, inv.kind)}。消費税は税率ごとに合計した金額から計算しています。</p>
    </PrintView>
  );
}
