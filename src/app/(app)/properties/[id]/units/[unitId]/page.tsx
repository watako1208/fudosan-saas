import { notFound } from "next/navigation";
import { requireStaffPage } from "@/lib/server/session";
import { getDoc } from "@/lib/server/repo";
import { saveUnit } from "@/lib/server/actions/properties";
import { C, Property, Unit } from "@/lib/types";
import { PageHeader } from "@/components/ui";
import { UnitForm } from "../UnitForm";

export default async function EditUnit({ params }: { params: Promise<{ id: string; unitId: string }> }) {
  const ctx = await requireStaffPage("property.read");
  const { id, unitId } = await params;
  const [p, u] = await Promise.all([getDoc<Property>(ctx, C.properties, id), getDoc<Unit>(ctx, C.units, unitId)]);
  if (!p || !u || u.propertyId !== id) notFound();
  return (
    <>
      <PageHeader title={`区画 ${u.number}`} sub={`${p.number} ${p.name}`} />
      <UnitForm
        action={saveUnit.bind(null, id, unitId)}
        initial={{ ...JSON.parse(JSON.stringify(u)), equipment: (u.equipment ?? []).join("、") }}
        version={u.version}
        cancelHref={`/properties/${id}?tab=units`}
      />
    </>
  );
}
