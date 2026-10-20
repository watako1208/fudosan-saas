import { notFound } from "next/navigation";
import { requireStaffPage, canAccessStore } from "@/lib/server/session";
import { getDoc, getMany } from "@/lib/server/repo";
import { staffOptions, storeList } from "@/lib/server/lookups";
import { updateDeal } from "@/lib/server/actions/deals";
import { C, Deal, Party, Property, Unit } from "@/lib/types";
import { PageHeader, StateMessage } from "@/components/ui";
import { DealForm } from "@/components/deals/DealForm";

export default async function EditDealPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaffPage("deal.write");
  const { id } = await params;
  const d = await getDoc<Deal>(ctx, C.deals, id);
  if (!d) notFound();
  if (!canAccessStore(ctx, d.storeId)) return <div className="card"><StateMessage kind="forbidden" message="この店舗の案件は編集できません" /></div>;
  const customer = d.customerId ? await getDoc<Party>(ctx, C.parties, d.customerId) : null;
  const props = await getMany<Property>(ctx, C.properties, d.propertyIds ?? []);
  const units = await getMany<Unit>(ctx, C.units, d.unitIds ?? []);
  const targets = [
    ...[...units.values()].map((u) => ({ propertyId: u.propertyId, unitId: u.id, label: `${props.get(u.propertyId)?.name ?? ""} ${u.number}` })),
    ...(d.propertyIds ?? []).filter((pid) => ![...units.values()].some((u) => u.propertyId === pid)).map((pid) => ({ propertyId: pid, unitId: null, label: `${props.get(pid)?.name ?? "（不明）"}（物件全体）` })),
  ];
  const { keywords: _k, ...rest } = d;
  void _k;
  return (
    <>
      <PageHeader title={`案件の編集: ${d.title}`} sub={d.number} />
      <DealForm
        isNew={false}
        action={updateDeal.bind(null, id)}
        initial={JSON.parse(JSON.stringify(rest))}
        version={d.version}
        customer={customer ? { id: customer.id, label: customer.name, sub: customer.number } : null}
        targets={targets}
        cancelHref={`/deals/${id}`}
        staff={await staffOptions(ctx)}
        stores={await storeList(ctx.companyId)}
      />
    </>
  );
}
