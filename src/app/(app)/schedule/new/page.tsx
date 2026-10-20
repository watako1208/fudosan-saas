import { requireStaffPage } from "@/lib/server/session";
import { getDoc } from "@/lib/server/repo";
import { staffOptions } from "@/lib/server/lookups";
import { saveEvent } from "@/lib/server/actions/schedule";
import { C, Deal, Party, Property } from "@/lib/types";
import { PageHeader } from "@/components/ui";
import { EventForm } from "@/components/schedule/EventForm";
import { SP } from "@/lib/server/query";
import { isValidBizDate, todayJst } from "@/lib/domain/dates";

export const metadata = { title: "予定の登録" };

const g = (sp: SP, k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");

export default async function NewEventPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireStaffPage("schedule.write");
  const sp = await searchParams;
  const date = isValidBizDate(g(sp, "date")) ? g(sp, "date") : todayJst();
  const deal = g(sp, "dealId") ? await getDoc<Deal>(ctx, C.deals, g(sp, "dealId")) : null;
  const party = g(sp, "partyId") ? await getDoc<Party>(ctx, C.parties, g(sp, "partyId")) : null;
  const prop = g(sp, "propertyId") ? await getDoc<Property>(ctx, C.properties, g(sp, "propertyId")) : null;
  const type = g(sp, "type") || "viewing";
  const back = deal ? `/deals/${deal.id}?tab=viewings` : "";
  return (
    <>
      <PageHeader title="予定の登録" />
      <EventForm
        action={saveEvent.bind(null, null)}
        initial={{
          title: type === "viewing" ? `内見${party ? ` ${party.name}様` : ""}${prop ? ` ${prop.name}` : ""}` : "",
          type,
          start: `${date}T10:00`,
          end: `${date}T11:00`,
          assigneeUid: deal?.assigneeUid ?? ctx.uid,
          dealId: deal?.id ?? "",
          _back: back,
          travelMinutes: type === "viewing" ? 30 : "",
        }}
        party={party ? { id: party.id, label: party.name, sub: party.number } : null}
        property={prop ? { propertyId: prop.id, unitId: null, label: prop.name } : null}
        dealLabel={deal ? `${deal.number} ${deal.title}` : null}
        cancelHref={back || "/schedule"}
        staff={await staffOptions(ctx)}
      />
    </>
  );
}
