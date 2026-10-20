import Link from "next/link";
import { requireExternalPage } from "@/lib/server/portal-access";
import { getMany } from "@/lib/server/repo";
import { C, Property, Unit } from "@/lib/types";
import { Badge, StateMessage } from "@/components/ui";
import { NoScope, NotForYou } from "@/components/portal/Guard";
import { REPAIR_STATUS, lbl, tone, RepairExt } from "@/lib/labels-support";

export const metadata = { title: "依頼一覧" };

export default async function VendorRepairs() {
  const { ctx, scope } = await requireExternalPage();
  if (!scope) return <NoScope />;
  if (scope.kind !== "vendor") return <NotForYou />;
  const reps = [...(await getMany<RepairExt>(ctx, C.repairs, [...scope.repairIds])).values()]
    .filter((r) => r.vendorPartyId === scope.partyId && !r.archived)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const [props, units] = await Promise.all([
    getMany<Property>(ctx, C.properties, reps.map((r) => r.propertyId ?? "")),
    getMany<Unit>(ctx, C.units, reps.map((r) => r.unitId ?? "")),
  ]);
  return (
    <>
      <h1 className="mb-4">ご依頼一覧</h1>
      {reps.length === 0 ? (
        <div className="card"><StateMessage kind="empty" message="割り当てられたご依頼はありません" /></div>
      ) : (
        <ul className="space-y-2">
          {reps.map((r) => {
            const p = r.propertyId ? props.get(r.propertyId) : undefined;
            const u = r.unitId ? units.get(r.unitId) : undefined;
            return (
              <li key={r.id}>
                <Link href={`/portal/repairs/${r.id}`} className="card block p-4 hover:border-primary">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={tone(REPAIR_STATUS, r.status)}>{lbl(REPAIR_STATUS, r.status)}</Badge>
                    <span className="text-sm text-muted">{r.number}</span>
                    {r.scheduledDate && <span className="text-sm">施工予定 {r.scheduledDate}</span>}
                  </div>
                  <p className="mt-1 font-semibold break-words">{p?.name ?? "物件"}{u ? ` ${u.number}` : ""}</p>
                  <p className="text-sm break-words">{r.equipment ? `${r.equipment}: ` : ""}{r.symptom}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
