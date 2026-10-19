import { requireStaffPage, currentStoreId } from "@/lib/server/session";
import { staffOptions, storeList } from "@/lib/server/lookups";
import { createProperty } from "@/lib/server/actions/properties";
import { PageHeader } from "@/components/ui";
import { PropertyForm } from "../PropertyForm";

export const metadata = { title: "物件の登録" };

export default async function NewPropertyPage() {
  const ctx = await requireStaffPage("property.write");
  return (
    <>
      <PageHeader title="物件の登録" />
      <PropertyForm
        action={createProperty}
        initial={{ kind: "building", assigneeUid: ctx.uid, storeId: (await currentStoreId(ctx)) ?? ctx.user.storeIds[0] ?? "", areas: [], access: [] }}
        cancelHref="/properties"
        staff={await staffOptions(ctx)}
        stores={await storeList(ctx.companyId)}
      />
    </>
  );
}
