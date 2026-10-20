import { notFound } from "next/navigation";
import { requireStaffPage, canAccessStore } from "@/lib/server/session";
import { getDoc, getMany } from "@/lib/server/repo";
import { saveApplication } from "@/lib/server/actions/applications";
import { C, Deal, Party, Property, Unit } from "@/lib/types";
import { PageHeader, StateMessage } from "@/components/ui";
import { ApplicationForm } from "@/components/deals/ApplicationForm";

export const metadata = { title: "申込みの登録" };

const DEFAULT_DOCS: Record<Deal["kind"], string[]> = {
  rental: ["入居申込書", "本人確認書類", "収入証明書類", "住民票"],
  sale: ["購入申込書（買付証明書）", "本人確認書類", "資金計画・融資事前審査の結果"],
};

export default async function NewApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaffPage("deal.write");
  const { id } = await params;
  const deal = await getDoc<Deal>(ctx, C.deals, id);
  if (!deal) notFound();
  if (!canAccessStore(ctx, deal.storeId)) return <div className="card"><StateMessage kind="forbidden" message="この店舗の案件は編集できません" /></div>;
  const customer = deal.customerId ? await getDoc<Party>(ctx, C.parties, deal.customerId) : null;
  const units = await getMany<Unit>(ctx, C.units, deal.unitIds ?? []);
  const props = await getMany<Property>(ctx, C.properties, [...units.values()].map((u) => u.propertyId));
  const unitOpts = [...units.values()].map((u) => ({ value: u.id, label: `${props.get(u.propertyId)?.name ?? ""} ${u.number}` }));
  return (
    <>
      <PageHeader title="申込みの登録" sub={`${deal.number} ${deal.title}`} />
      <ApplicationForm
        action={saveApplication.bind(null, id, null)}
        initial={{
          status: "docs_missing",
          unitId: unitOpts.length === 1 ? unitOpts[0].value : "",
          submittedDocs: DEFAULT_DOCS[deal.kind].map((name) => ({ name, received: false, attachmentId: null })),
        }}
        applicant={customer ? { id: customer.id, label: customer.name, sub: customer.number } : null}
        occupants={[]}
        units={unitOpts}
        attachments={[]}
        canSensitive={ctx.caps.has("party.sensitive")}
        cancelHref={`/deals/${id}?tab=applications`}
      />
    </>
  );
}
