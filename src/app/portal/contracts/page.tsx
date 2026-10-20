import { requireExternalPage } from "@/lib/server/portal-access";
import { getMany } from "@/lib/server/repo";
import { C, Contract, ContractVersion, Unit, Property } from "@/lib/types";
import { Card, DL, StateMessage } from "@/components/ui";
import { NoScope, NotForYou } from "@/components/portal/Guard";
import { yen } from "@/lib/domain/money";

export const metadata = { title: "ご契約" };

const VISIBLE = ["executed", "active", "ended"];

/** 入居者: 自分の契約の概要（部屋・期間・月額費用）。他の当事者の情報は表示しない */
export default async function PortalContracts() {
  const { ctx, scope } = await requireExternalPage();
  if (!scope) return <NoScope />;
  if (scope.kind !== "tenant") return <NotForYou />;
  const contracts = [...(await getMany<Contract>(ctx, C.contracts, [...scope.contractIds])).values()]
    .filter((c) => (c.partyIds ?? []).includes(scope.partyId) && VISIBLE.includes(c.status) && c.kind === "lease")
    .sort((a, b) => (b.start ?? "").localeCompare(a.start ?? ""));
  const [versions, units] = await Promise.all([
    getMany<ContractVersion>(ctx, C.contractVersions, contracts.map((c) => c.currentVersionId ?? "")),
    getMany<Unit>(ctx, C.units, contracts.map((c) => c.unitId ?? "")),
  ]);
  const props = await getMany<Property>(ctx, C.properties, [...units.values()].map((u) => u.propertyId));
  if (!contracts.length) return <div className="card"><StateMessage kind="empty" message="表示できるご契約はありません" /></div>;
  return (
    <>
      <h1 className="mb-4">ご契約</h1>
      <div className="space-y-4">
        {contracts.map((c) => {
          const v = c.currentVersionId ? versions.get(c.currentVersionId) : undefined;
          const u = c.unitId ? units.get(c.unitId) : undefined;
          const p = u ? props.get(u.propertyId) : undefined;
          const monthly = (v?.monthlyItems ?? []).filter((m) => m.amount !== null);
          return (
            <Card key={c.id} title={`${p?.name ?? "物件"}${u ? ` ${u.number}` : ""}`}>
              <DL
                items={[
                  ["契約番号", c.number],
                  ["所在地", p?.address ?? null],
                  ["契約期間", v?.start || c.start ? `${v?.start ?? c.start} 〜 ${v?.end ?? c.end ?? "期間の定めなし"}` : null],
                  ["状態", c.status === "ended" ? "終了" : "契約中"],
                  ["お支払期日", v?.paymentDueDay ? `毎月${v.paymentDueDay}日（${v.paymentTiming === "prev_month" ? "前月払い" : "当月払い"}）` : null],
                ]}
              />
              <h3 className="mt-4 mb-2 text-sm">月額費用（現在の契約条件）</h3>
              {monthly.length === 0 ? (
                <p className="text-sm text-muted">登録された月額費用はありません</p>
              ) : (
                <table className="table">
                  <tbody>
                    {monthly.map((m, i) => (
                      <tr key={i}><td>{m.name}</td><td className="num">{yen(m.amount)}</td></tr>
                    ))}
                    <tr><td className="font-semibold">合計</td><td className="num font-semibold">{yen(monthly.reduce((s, m) => s + m.amount, 0))}</td></tr>
                  </tbody>
                </table>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}
