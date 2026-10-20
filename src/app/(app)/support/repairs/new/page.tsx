import { requireStaffPage } from "@/lib/server/session";
import { getDoc } from "@/lib/server/repo";
import { staffOptions } from "@/lib/server/lookups";
import { createRepair } from "@/lib/server/actions/repairs";
import { SP } from "@/lib/server/query";
import { C, Inquiry, Property } from "@/lib/types";
import { PageHeader } from "@/components/ui";
import { RepairForm } from "@/components/support/RepairForm";

export const metadata = { title: "修繕案件登録" };

export default async function NewRepairPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireStaffPage("repair.write");
  const sp = await searchParams;
  const inquiryId = typeof sp.inquiryId === "string" ? sp.inquiryId : null;
  const inq = inquiryId ? await getDoc<Inquiry>(ctx, C.inquiries, inquiryId) : null;
  const property = inq?.propertyId ? await getDoc<Property>(ctx, C.properties, inq.propertyId) : null;
  return (
    <>
      <PageHeader title="修繕案件を登録" sub={inq ? `問い合わせ ${inq.number}（${inq.partyName ?? ""}）から作成します。作成後、問い合わせと相互に関連づけます。` : undefined} />
      <RepairForm
        action={createRepair}
        inquiryId={inq?.id ?? null}
        initial={{ propertyId: inq?.propertyId ?? "", unitId: inq?.unitId ?? "", symptom: inq?.content ?? "", assigneeUid: inq?.assigneeUid ?? ctx.uid }}
        propertyLabel={property ? `${property.name}（${property.number}）` : null}
        cancelHref={inq ? `/support/${inq.id}` : "/support/repairs"}
        staff={await staffOptions(ctx)}
      />
    </>
  );
}
