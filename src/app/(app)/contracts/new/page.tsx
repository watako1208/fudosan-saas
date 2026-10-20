import Link from "next/link";
import { requireStaffPage } from "@/lib/server/session";
import { getDoc, getMany } from "@/lib/server/repo";
import { SP } from "@/lib/server/query";
import { C, Deal, Unit, Property, Party } from "@/lib/types";
import { PageHeader, Card, DL } from "@/components/ui";
import { NewContractForm } from "@/components/contracts/NewContractForm";

export const metadata = { title: "契約の作成" };

export default async function NewContractPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireStaffPage("contract.write");
  const sp = await searchParams;
  const g = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : null);
  const deal = g("dealId") ? await getDoc<Deal>(ctx, C.deals, g("dealId")!) : null;
  const kind: "lease" | "sale" = g("kind") === "sale" || g("kind") === "lease" ? (g("kind") as "lease" | "sale") : deal?.kind === "sale" ? "sale" : "lease";
  const unitId = g("unitId") ?? (kind === "lease" ? deal?.unitIds?.[0] ?? null : null);
  const unit = unitId ? await getDoc<Unit>(ctx, C.units, unitId) : null;
  const propertyIds = kind === "sale" ? (g("propertyId") ? [g("propertyId")!] : deal?.propertyIds ?? []) : [];
  const props = await getMany<Property>(ctx, C.properties, [...propertyIds, unit?.propertyId ?? ""]);
  const customer = deal?.customerId ? await getDoc<Party>(ctx, C.parties, deal.customerId) : null;
  const unitLabel = unit ? `${props.get(unit.propertyId)?.name ?? ""} ${unit.number}` : null;
  const q = (k: "lease" | "sale") => {
    const p = new URLSearchParams();
    p.set("kind", k);
    if (deal) p.set("dealId", deal.id);
    if (unitId && k === "lease") p.set("unitId", unitId);
    return `/contracts/new?${p.toString()}`;
  };

  return (
    <>
      <PageHeader title={kind === "lease" ? "賃貸借契約の作成" : "売買契約の作成"} sub="下書きを作成してから、契約条件・当事者・費用を編集します" />
      <div className="mb-4 flex gap-2" role="tablist" aria-label="契約の種類">
        <Link href={q("lease")} className={`btn ${kind === "lease" ? "btn-primary" : "btn-secondary"}`} aria-current={kind === "lease" ? "page" : undefined}>賃貸借</Link>
        <Link href={q("sale")} className={`btn ${kind === "sale" ? "btn-primary" : "btn-secondary"}`} aria-current={kind === "sale" ? "page" : undefined}>売買</Link>
      </div>
      {g("dealId") && !deal && <p className="mb-4 rounded-md bg-danger-soft p-3 text-sm text-danger">指定された仲介案件が見つからないか、閲覧権限がありません。</p>}
      {deal && (
        <Card title="引き継ぐ仲介案件" className="mb-4">
          <DL
            items={[
              ["案件", <Link key="d" href={`/deals/${deal.id}`} className="text-primary hover:underline">{deal.number} {deal.title}</Link>],
              [kind === "lease" ? "借主（顧客）" : deal.side === "seller" ? "売主（顧客）" : "買主（顧客）", customer?.name ?? null],
              ["作成後", "案件に契約を関連づけます"],
            ]}
          />
        </Card>
      )}
      <NewContractForm
        kind={kind}
        dealId={deal?.id ?? null}
        unitId={unit?.id ?? null}
        unitLabel={unitLabel}
        propertyIds={propertyIds.filter((id) => props.has(id))}
        propertyLabels={Object.fromEntries([...props.values()].map((p) => [p.id, p.name]))}
      />
    </>
  );
}
