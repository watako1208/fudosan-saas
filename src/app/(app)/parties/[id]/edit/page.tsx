import { notFound } from "next/navigation";
import { requireStaffPage } from "@/lib/server/session";
import { getDoc } from "@/lib/server/repo";
import { staffOptions, storeList } from "@/lib/server/lookups";
import { updateParty } from "@/lib/server/actions/parties";
import { C, Party } from "@/lib/types";
import type { PartyExt } from "@/lib/types-deals";
import { PageHeader } from "@/components/ui";
import { PartyForm } from "@/components/parties/PartyForm";

export default async function EditPartyPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaffPage("party.write");
  const { id } = await params;
  const p = await getDoc<PartyExt>(ctx, C.parties, id);
  if (!p) notFound();
  const corp = p.corporationId ? await getDoc<Party>(ctx, C.parties, p.corporationId) : null;
  // 検索用の内部項目は画面へ渡さない
  const { keywords: _k, phoneNorms: _p, emailNorm: _e, nameKey: _n, ...rest } = p;
  void _k; void _p; void _e; void _n;
  return (
    <>
      <PageHeader title={`顧客の編集: ${p.name}`} sub={p.number} />
      <PartyForm
        action={updateParty.bind(null, id)}
        initial={JSON.parse(JSON.stringify({ ...rest, manualRoles: p.manualRoles ?? [] }))}
        version={p.version}
        cancelHref={`/parties/${id}`}
        staff={await staffOptions(ctx)}
        stores={await storeList(ctx.companyId)}
        corporation={corp ? { id: corp.id, label: corp.name, sub: corp.number } : null}
        selfId={id}
      />
    </>
  );
}
