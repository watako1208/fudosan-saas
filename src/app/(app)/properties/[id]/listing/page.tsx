import { notFound } from "next/navigation";
import { requireStaffPage } from "@/lib/server/session";
import { getDoc, findDocs } from "@/lib/server/repo";
import { saveListing } from "@/lib/server/actions/properties";
import { C, Property, Unit, Listing } from "@/lib/types";
import { PageHeader } from "@/components/ui";
import { ListingForm } from "./ListingForm";
import { todayJst } from "@/lib/domain/dates";
import { SP } from "@/lib/server/query";

export default async function ListingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const ctx = await requireStaffPage("property.write");
  const { id } = await params;
  const sp = await searchParams;
  const p = await getDoc<Property>(ctx, C.properties, id);
  if (!p) notFound();
  const units = await findDocs<Unit>(ctx, C.units, [["propertyId", "==", id]]);
  const from = typeof sp.from === "string" ? await getDoc<Listing>(ctx, C.listings, sp.from) : null;
  const initial = from && from.propertyId === id
    ? { ...JSON.parse(JSON.stringify(from)), previousId: from.id, effectiveFrom: todayJst() }
    : { dealType: "rent", status: "preparing", effectiveFrom: todayJst(), unitId: typeof sp.unitId === "string" ? sp.unitId : "" };
  return (
    <>
      <PageHeader title={from ? "募集条件の変更" : "募集条件の登録"} sub={`${p.number} ${p.name}（変更すると新しい版として保存し、過去の条件は残ります）`} />
      <ListingForm
        action={saveListing.bind(null, id)}
        initial={initial}
        units={units.map((u) => ({ value: u.id, label: u.number }))}
        cancelHref={`/properties/${id}?tab=listing`}
      />
    </>
  );
}
