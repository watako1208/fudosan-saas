import Link from "next/link";
import { requireExternalPage } from "@/lib/server/portal-access";
import { col, getMany } from "@/lib/server/repo";
import { C, Property } from "@/lib/types";
import { Badge, StateMessage } from "@/components/ui";
import { NoScope, NotForYou } from "@/components/portal/Guard";
import { EstimateExt, RepairExt } from "@/lib/labels-support";
import { yen } from "@/lib/domain/money";

export const metadata = { title: "見積の承認" };

export default async function PortalEstimates() {
  const { ctx, scope } = await requireExternalPage();
  if (!scope) return <NoScope />;
  if (scope.kind !== "owner") return <NotForYou />;
  const snap = await col(ctx.companyId, C.estimates).where("ownerPartyIds", "array-contains", scope.partyId).limit(200).get();
  const ests = snap.docs
    .map((d) => ({ ...(d.data() as EstimateExt), id: d.id }))
    .filter((e) => scope.estimateIds.has(e.id) && e.ownerApprovalRequested)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const repairs = await getMany<RepairExt>(ctx, C.repairs, ests.map((e) => e.repairId));
  const props = await getMany<Property>(ctx, C.properties, [...repairs.values()].map((r) => r.propertyId ?? ""));
  return (
    <>
      <h1 className="mb-4">見積の承認</h1>
      {ests.length === 0 ? (
        <div className="card"><StateMessage kind="empty" message="承認依頼はありません" /></div>
      ) : (
        <ul className="space-y-2">
          {ests.map((e) => {
            const r = repairs.get(e.repairId);
            const p = r?.propertyId ? props.get(r.propertyId) : undefined;
            const st = e.status === "submitted" ? <Badge tone="warn">回答待ち</Badge> : e.externalApproval?.partyId === scope.partyId ? <Badge tone="ok">回答済み</Badge> : <Badge>受付終了</Badge>;
            return (
              <li key={e.id}>
                <Link href={`/portal/estimates/${e.id}`} className="card block p-4 hover:border-primary">
                  <div className="flex flex-wrap items-center gap-2">{st}<span className="text-sm text-muted">第{e.versionNo}版</span></div>
                  <p className="mt-1 font-semibold break-words">{p?.name ?? "物件"} ／ {r?.equipment ?? r?.symptom.slice(0, 40) ?? "修繕"}</p>
                  <p className="text-sm">見積合計 {yen(e.total)}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
