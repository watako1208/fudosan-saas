import { requireStaffPage } from "@/lib/server/session";
import { getDoc } from "@/lib/server/repo";
import { SP } from "@/lib/server/query";
import { companySettings } from "@/lib/server/lookups";
import { itemTypeList } from "@/lib/server/jobs/billing";
import { C, Contract, ContractVersion } from "@/lib/types";
import { PageHeader, StateMessage } from "@/components/ui";
import { InvoiceForm } from "@/components/billing/InvoiceForm";
import type { EditableLine } from "@/components/billing/LineEditor";
import { todayJst } from "@/lib/domain/dates";

export const metadata = { title: "請求の作成" };

const ROLE: Record<string, string> = { lessee: "借主", lessor: "貸主", guarantor: "連帯保証人", buyer: "買主", seller: "売主", occupant: "同居人", agent: "代理人" };

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireStaffPage("billing.write");
  const sp = await searchParams;
  const g = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const kind = g("kind") === "initial" ? "initial" : "one_time";
  const contractId = g("contractId");
  const contract = contractId ? await getDoc<Contract>(ctx, C.contracts, contractId) : null;
  if (contractId && !contract) {
    return (
      <>
        <PageHeader title="請求の作成" />
        <div className="card"><StateMessage kind="error" message="指定された契約が見つからないか、閲覧権限がありません" /></div>
      </>
    );
  }
  const version = contract?.currentVersionId ? await getDoc<ContractVersion>(ctx, C.contractVersions, contract.currentVersionId) : null;
  const types = await itemTypeList(ctx);
  const settings = await companySettings(ctx.companyId);
  const parties = (version?.parties ?? []).filter((p) => p.role !== "agent");
  parties.sort((a, b) => (a.role === "lessee" ? -1 : b.role === "lessee" ? 1 : 0));
  const billToOptions = parties.map((p) => ({ value: p.partyId, label: `${p.name}（${ROLE[p.role] ?? p.role}・契約時点）` }));
  const lessee = parties.find((p) => p.role === "lessee");

  const typeOf = (code: string) => types.find((t) => t.code === code);
  let lines: EditableLine[] = [];
  const item = g("item");
  if (item && typeOf(item)) {
    const t = typeOf(item)!;
    lines = [{ itemCode: t.code, name: t.name, quantity: "1", unitPrice: "", tax: t.tax }];
  } else if (kind === "initial" && version) {
    lines = (version.initialItems ?? []).map((i) => ({ itemCode: i.code, name: i.name, quantity: "1", unitPrice: String(i.amount), tax: i.tax }));
    const dep = typeOf("security_deposit");
    if (version.depositAmount && dep && !lines.some((l) => l.itemCode === dep.code)) {
      lines.push({ itemCode: dep.code, name: dep.name, quantity: "1", unitPrice: String(version.depositAmount), tax: dep.tax });
    }
  }
  if (!lines.length) {
    const t = types.find((x) => x.kind === (kind === "initial" ? "initial" : "one_time")) ?? types[0];
    if (t) lines = [{ itemCode: t.code, name: t.name, quantity: "1", unitPrice: "", tax: t.tax }];
  }

  return (
    <>
      <PageHeader
        title={kind === "initial" ? "初期費用の請求を作成" : "一時請求を作成"}
        sub={contract ? `対象契約: ${contract.number} ${contract.title}` : "契約に紐づかない請求も作成できます"}
      />
      <InvoiceForm
        initial={{ kind, contractId: contract?.id ?? "", billToPartyId: lessee?.partyId ?? "", issueDate: todayJst(), dueDate: "" }}
        billToOptions={billToOptions}
        itemTypes={types.map((t) => ({ code: t.code, name: t.name, tax: t.tax }))}
        lines={lines}
        canConfirm={ctx.caps.has("billing.confirm")}
        cancelHref={contract ? `/contracts/${contract.id}` : "/billing"}
        lineRounding={settings.lineRounding ?? "floor"}
        taxRounding={settings.taxRounding ?? "floor"}
      />
    </>
  );
}
