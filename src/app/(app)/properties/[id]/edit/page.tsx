import { notFound } from "next/navigation";
import { requireStaffPage } from "@/lib/server/session";
import { getDoc } from "@/lib/server/repo";
import { staffOptions, storeList } from "@/lib/server/lookups";
import { updateProperty } from "@/lib/server/actions/properties";
import { C, Property } from "@/lib/types";
import { PageHeader } from "@/components/ui";
import { PropertyForm } from "../../PropertyForm";

export default async function EditPropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaffPage("property.write");
  const { id } = await params;
  const p = await getDoc<Property>(ctx, C.properties, id);
  if (!p) notFound();
  return (
    <>
      <PageHeader title={`物件の編集: ${p.name}`} sub={p.number} />
      <PropertyForm
        action={updateProperty.bind(null, id)}
        initial={JSON.parse(JSON.stringify(p))}
        version={p.version}
        cancelHref={`/properties/${id}`}
        staff={await staffOptions(ctx)}
        stores={await storeList(ctx.companyId)}
      />
    </>
  );
}
