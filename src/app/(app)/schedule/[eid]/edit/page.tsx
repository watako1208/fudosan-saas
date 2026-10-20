import { notFound } from "next/navigation";
import { requireStaffPage } from "@/lib/server/session";
import { getDoc } from "@/lib/server/repo";
import { staffOptions } from "@/lib/server/lookups";
import { saveEvent } from "@/lib/server/actions/schedule";
import { C, Deal, Party, Property, Unit, EventDoc } from "@/lib/types";
import { PageHeader } from "@/components/ui";
import { EventForm } from "@/components/schedule/EventForm";
import { isoToJstLocal } from "@/lib/domain/deals";

export default async function EditEventPage({ params }: { params: Promise<{ eid: string }> }) {
  const ctx = await requireStaffPage("schedule.write");
  const { eid } = await params;
  const e = await getDoc<EventDoc>(ctx, C.events, eid);
  if (!e) notFound();
  const deal = e.dealId ? await getDoc<Deal>(ctx, C.deals, e.dealId) : null;
  const party = e.partyId ? await getDoc<Party>(ctx, C.parties, e.partyId) : null;
  const prop = e.propertyId ? await getDoc<Property>(ctx, C.properties, e.propertyId) : null;
  const unit = e.unitId ? await getDoc<Unit>(ctx, C.units, e.unitId) : null;
  return (
    <>
      <PageHeader title={`予定の編集: ${e.title}`} />
      <EventForm
        action={saveEvent.bind(null, eid)}
        initial={{ ...JSON.parse(JSON.stringify(e)), start: isoToJstLocal(e.start), end: isoToJstLocal(e.end), _back: "" }}
        version={e.version}
        party={party ? { id: party.id, label: party.name, sub: party.number } : null}
        property={prop ? { propertyId: prop.id, unitId: unit?.id ?? null, label: `${prop.name}${unit ? ` ${unit.number}` : ""}` } : null}
        dealLabel={deal ? `${deal.number} ${deal.title}` : null}
        cancelHref={`/schedule/${eid}`}
        staff={await staffOptions(ctx)}
      />
    </>
  );
}
