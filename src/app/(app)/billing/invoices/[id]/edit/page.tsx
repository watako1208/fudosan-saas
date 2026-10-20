import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffPage } from "@/lib/server/session";
import { getDoc } from "@/lib/server/repo";
import { companySettings } from "@/lib/server/lookups";
import { itemTypeList, isLocked } from "@/lib/server/jobs/billing";
import { C, Contract, ContractVersion, Invoice } from "@/lib/types";
import { PageHeader, StateMessage } from "@/components/ui";
import { InvoiceForm } from "@/components/billing/InvoiceForm";

export const metadata = { title: "請求の編集" };

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaffPage("billing.write");
  const { id } = await params;
  const inv = await getDoc<Invoice>(ctx, C.invoices, id);
  if (!inv) notFound();
  if (inv.status !== "draft" || (await isLocked(ctx, inv.period))) {
    return (
      <>
        <PageHeader title={`請求 ${inv.number} の編集`} />
        <div className="card">
          <StateMessage
            kind="forbidden"
            message={inv.status !== "draft" ? "確定済み・取消済みの請求は編集できません。取消または訂正（差額調整）を行ってください。" : "月次締め済みの期間の請求は編集できません。"}
            action={<Link className="btn btn-secondary" href={`/billing/invoices/${id}`}>請求に戻る</Link>}
          />
        </div>
      </>
    );
  }
  const contract = inv.contractId ? await getDoc<Contract>(ctx, C.contracts, inv.contractId) : null;
  const version = contract?.currentVersionId ? await getDoc<ContractVersion>(ctx, C.contractVersions, contract.currentVersionId) : null;
  const types = await itemTypeList(ctx);
  const settings = await companySettings(ctx.companyId);
  const opts = [{ value: inv.billToPartyId, label: `${inv.billToName}（現在の請求先）` }];
  for (const p of version?.parties ?? []) if (p.role !== "agent" && p.partyId !== inv.billToPartyId) opts.push({ value: p.partyId, label: `${p.name}（契約当事者）` });
  const auto = inv.lines.filter((l) => l.dedupeKey);
  const manual = inv.lines.filter((l) => !l.dedupeKey);
  return (
    <>
      <PageHeader title={`請求 ${inv.number} の編集（下書き）`} sub={inv.kind === "monthly" ? "月額の自動明細は契約条件から計算されます。変更は契約版の変更と再計算で行い、ここでは手入力の明細だけを追加・変更できます。" : undefined} />
      <InvoiceForm
        initial={{ id: inv.id, kind: inv.kind, contractId: inv.contractId ?? "", billToPartyId: inv.billToPartyId, issueDate: inv.issueDate, dueDate: inv.dueDate ?? "", period: inv.period ?? "" }}
        version={inv.version}
        billToOptions={opts}
        itemTypes={types.map((t) => ({ code: t.code, name: t.name, tax: t.tax }))}
        lines={manual.map((l) => ({ itemCode: l.itemCode, name: l.name, quantity: l.quantity, unitPrice: l.unitPrice, tax: l.tax }))}
        lockedLines={auto.map((l) => ({ name: l.name, amount: l.amount, formula: l.formula, tax: l.tax }))}
        canConfirm={ctx.caps.has("billing.confirm")}
        cancelHref={`/billing/invoices/${id}`}
        isMonthly={inv.kind === "monthly"}
        lineRounding={settings.lineRounding ?? "floor"}
        taxRounding={settings.taxRounding ?? "floor"}
      />
    </>
  );
}
