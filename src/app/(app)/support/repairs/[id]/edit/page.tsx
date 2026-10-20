import { notFound } from "next/navigation";
import { requireStaffPage, canAccessStore } from "@/lib/server/session";
import { getDoc } from "@/lib/server/repo";
import { staffOptions } from "@/lib/server/lookups";
import { updateRepair } from "@/lib/server/actions/repairs";
import { C, Property, Party } from "@/lib/types";
import { PageHeader, StateMessage } from "@/components/ui";
import { RepairForm } from "@/components/support/RepairForm";
import type { RepairExt } from "@/lib/labels-support";

export const metadata = { title: "修繕案件編集" };

export default async function EditRepairPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaffPage("repair.write");
  const { id } = await params;
  const r = await getDoc<RepairExt>(ctx, C.repairs, id);
  if (!r) notFound();
  if (!canAccessStore(ctx, r.storeId)) return <div className="card"><StateMessage kind="forbidden" /></div>;
  const [property, vendor] = await Promise.all([
    r.propertyId ? getDoc<Property>(ctx, C.properties, r.propertyId) : null,
    r.vendorPartyId ? getDoc<Party>(ctx, C.parties, r.vendorPartyId) : null,
  ]);
  return (
    <>
      <PageHeader title={`修繕案件を編集（${r.number}）`} />
      <RepairForm
        action={updateRepair.bind(null, id)}
        version={r.version}
        initial={{ ...r }}
        cancelHref={`/support/repairs/${id}`}
        staff={await staffOptions(ctx)}
        propertyLabel={property ? `${property.name}（${property.number}）` : null}
        vendorLabel={vendor ? `${vendor.name}（${vendor.number}）` : null}
      />
    </>
  );
}
