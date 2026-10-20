import { notFound } from "next/navigation";
import { requireStaffPage } from "@/lib/server/session";
import { getDoc } from "@/lib/server/repo";
import { recordEventResult } from "@/lib/server/actions/schedule";
import { C, EventDoc, Property, Party } from "@/lib/types";
import { PageHeader, Card, DL } from "@/components/ui";
import { ResultForm } from "@/components/schedule/ResultForm";
import { formatDateTimeJst } from "@/lib/domain/dates";

export const metadata = { title: "内見記録" };

/** スマートフォンで内見・予定の実施結果を記録する */
export default async function EventResultPage({ params }: { params: Promise<{ eid: string }> }) {
  const ctx = await requireStaffPage("schedule.write");
  const { eid } = await params;
  const e = await getDoc<EventDoc>(ctx, C.events, eid);
  if (!e) notFound();
  const prop = e.propertyId ? await getDoc<Property>(ctx, C.properties, e.propertyId) : null;
  const party = e.partyId ? await getDoc<Party>(ctx, C.parties, e.partyId) : null;
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title={e.type === "viewing" ? "内見記録" : "実施結果の記録"} sub={e.title} />
      <Card className="mb-4">
        <DL
          items={[
            ["日時", formatDateTimeJst(e.start)],
            ["顧客", party?.name ?? null],
            ["物件", prop ? `${prop.name}${prop.address ? `（${prop.address}）` : ""}` : null],
            ["集合場所", e.place],
            ["鍵の受取", e.keyPickup],
          ]}
        />
      </Card>
      <ResultForm action={recordEventResult.bind(null, eid)} initial={{ result: e.result ?? "" }} version={e.version} cancelHref={`/schedule/${eid}`} hasDeal={!!e.dealId} />
    </div>
  );
}
