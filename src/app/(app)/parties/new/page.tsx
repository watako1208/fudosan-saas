import { requireStaffPage, currentStoreId } from "@/lib/server/session";
import { staffOptions, storeList } from "@/lib/server/lookups";
import { createParty } from "@/lib/server/actions/parties";
import { PageHeader } from "@/components/ui";
import { PartyForm } from "@/components/parties/PartyForm";
import { getDoc } from "@/lib/server/repo";
import { C, Party } from "@/lib/types";
import { SP } from "@/lib/server/query";

export const metadata = { title: "顧客の登録" };

export default async function NewPartyPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireStaffPage("party.write");
  const sp = await searchParams;
  const corp = typeof sp.corporationId === "string" ? await getDoc<Party>(ctx, C.parties, sp.corporationId) : null;
  const corporation = corp && corp.type === "corporation" ? { id: corp.id, label: corp.name, sub: corp.number } : null;
  return (
    <>
      <PageHeader title="顧客の登録" sub="同じ人物・法人を重複して登録しないよう、保存時に重複候補を確認します（自動統合はしません）" />
      <PartyForm
        action={createParty}
        initial={{ type: "person", supportStatus: "open", assigneeUid: ctx.uid, storeId: (await currentStoreId(ctx)) ?? ctx.user.storeIds[0] ?? "", manualRoles: [], corporationId: corporation?.id ?? "" }}
        corporation={corporation}
        cancelHref="/parties"
        staff={await staffOptions(ctx)}
        stores={await storeList(ctx.companyId)}
      />
    </>
  );
}
