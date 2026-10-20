import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffPage } from "@/lib/server/session";
import { getDoc, findDocs, getMany } from "@/lib/server/repo";
import { itemTypes } from "@/lib/server/lookups";
import { C, Property, Ownership, Party } from "@/lib/types";
import { PageHeader, Card } from "@/components/ui";
import { OwnersEditor } from "@/components/parties/OwnersEditor";
import { todayJst } from "@/lib/domain/dates";
import { yen } from "@/lib/domain/money";

export const metadata = { title: "所有者の編集" };

export default async function OwnersPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaffPage("property.write");
  const { id } = await params;
  const p = await getDoc<Property>(ctx, C.properties, id);
  if (!p) notFound();
  const today = todayJst();
  const owns = (await findDocs<Ownership>(ctx, C.ownerships, [["propertyId", "==", id]])).filter((o) => !o.archived);
  const parties = await getMany<Party>(ctx, C.parties, owns.map((o) => o.partyId));
  const active = owns.filter((o) => !o.to || o.to >= today);
  const history = owns.filter((o) => o.to && o.to < today).sort((a, b) => (a.from < b.from ? 1 : -1));
  const types = await itemTypes(ctx.companyId);
  const nm = (pid: string) => parties.get(pid)?.name ?? "（不明）";

  return (
    <>
      <PageHeader title="所有者・送金配分・管理料" sub={<><Link className="text-primary hover:underline" href={`/properties/${id}`}>{p.number} {p.name}</Link></>} />
      <OwnersEditor
        propertyId={id}
        today={today}
        itemTypes={types.filter((t) => t.kind === "monthly").map((t) => ({ code: t.code, name: t.name, target: t.managementFeeTarget }))}
        initial={active.map((o) => ({
          id: o.id,
          partyId: o.partyId,
          partyLabel: nm(o.partyId),
          share: o.share,
          remitRatio: o.remitRatio ?? null,
          remainderReceiver: !!o.remainderReceiver,
          managementFee: o.managementFee ?? null,
          managedBy: o.managedBy ?? null,
          from: o.from,
        }))}
      />
      <Card title="過去の所有者・条件（終了済み）" className="mt-4 mb-24">
        {history.length === 0 ? (
          <p className="text-muted">終了した記録はありません</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>所有者</th><th>持分</th><th>送金配分</th><th>管理料</th><th>期間</th></tr></thead>
              <tbody>
                {history.map((o) => (
                  <tr key={o.id}>
                    <td><Link className="text-primary hover:underline" href={`/parties/${o.partyId}`}>{nm(o.partyId)}</Link></td>
                    <td>{o.share}</td>
                    <td>{o.remitRatio ?? "未設定"}{o.remainderReceiver ? "（端数受取）" : ""}</td>
                    <td>{o.managementFee ? (o.managementFee.kind === "fixed" ? `定額 ${yen(o.managementFee.fixedAmount ?? 0)}` : `料率 ${o.managementFee.rate}`) : "未設定"}</td>
                    <td>{o.from}〜{o.to}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
