import { notFound } from "next/navigation";
import { requireStaffPage, canAccessStore } from "@/lib/server/session";
import { getDoc } from "@/lib/server/repo";
import { staffOptions } from "@/lib/server/lookups";
import { updateInquiry } from "@/lib/server/actions/support";
import { C, Inquiry, Property, Party } from "@/lib/types";
import { PageHeader, StateMessage } from "@/components/ui";
import { InquiryForm } from "@/components/support/InquiryForm";

export const metadata = { title: "問い合わせ編集" };

function isoToLocalJst(iso: string): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)).replace(" ", "T");
}

export default async function EditInquiryPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaffPage("repair.write");
  const { id } = await params;
  const i = await getDoc<Inquiry>(ctx, C.inquiries, id);
  if (!i) notFound();
  if (!canAccessStore(ctx, i.storeId)) return <div className="card"><StateMessage kind="forbidden" /></div>;
  const [party, property] = await Promise.all([
    i.partyId ? getDoc<Party>(ctx, C.parties, i.partyId) : null,
    i.propertyId ? getDoc<Property>(ctx, C.properties, i.propertyId) : null,
  ]);
  const update = updateInquiry.bind(null, id);
  return (
    <>
      <PageHeader title={`問い合わせを編集（${i.number}）`} />
      <InquiryForm
        action={update}
        version={i.version}
        initial={{ ...i, receivedAt: isoToLocalJst(i.receivedAt), partyName: i.partyId ? "" : i.partyName }}
        cancelHref={`/support/${id}`}
        staff={await staffOptions(ctx)}
        partyLabel={party ? `${party.name}（${party.number}）` : null}
        propertyLabel={property ? `${property.name}（${property.number}）` : null}
      />
    </>
  );
}
