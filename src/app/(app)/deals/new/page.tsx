import { requireStaffPage, currentStoreId } from "@/lib/server/session";
import { getDoc } from "@/lib/server/repo";
import { staffOptions, storeList } from "@/lib/server/lookups";
import { createDeal } from "@/lib/server/actions/deals";
import { C, Party } from "@/lib/types";
import { PageHeader } from "@/components/ui";
import { DealForm } from "@/components/deals/DealForm";
import { SP } from "@/lib/server/query";

export const metadata = { title: "仲介案件の登録" };

export default async function NewDealPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireStaffPage("deal.write");
  const sp = await searchParams;
  const cid = typeof sp.customerId === "string" ? sp.customerId : "";
  const customer = cid ? await getDoc<Party>(ctx, C.parties, cid) : null;
  const kind = sp.kind === "sale" ? "sale" : "rental";
  return (
    <>
      <PageHeader title="仲介案件の登録" />
      <DealForm
        isNew
        action={createDeal}
        initial={{
          kind,
          side: kind === "sale" ? "buyer" : "tenant",
          title: customer ? `${customer.name}様 ${kind === "sale" ? "購入" : "お部屋探し"}` : "",
          customerId: customer?.id ?? "",
          assigneeUid: ctx.uid,
          storeId: (await currentStoreId(ctx)) ?? ctx.user.storeIds[0] ?? "",
          conditions: customer?.preferences ?? "",
        }}
        customer={customer ? { id: customer.id, label: customer.name, sub: customer.number } : null}
        targets={[]}
        cancelHref={customer ? `/parties/${customer.id}?tab=deals` : "/deals"}
        staff={await staffOptions(ctx)}
        stores={await storeList(ctx.companyId)}
      />
    </>
  );
}
