import { requireExternalPage } from "@/lib/server/portal-access";
import { col } from "@/lib/server/repo";
import { C, Settlement } from "@/lib/types";
import { Card, DL, StateMessage } from "@/components/ui";
import { NoScope, NotForYou } from "@/components/portal/Guard";
import { yen } from "@/lib/domain/money";

export const metadata = { title: "収支報告" };

const STATUS: Record<string, string> = {
  confirmed: "確定", partially_remitted: "一部送金済み", remitted: "送金済み", corrected: "訂正あり", review: "確認中", calculating: "計算中",
};

/** オーナー: 公開済みの精算報告（自分宛てのみ） */
export default async function PortalSettlements() {
  const { ctx, scope } = await requireExternalPage();
  if (!scope) return <NoScope />;
  if (scope.kind !== "owner") return <NotForYou />;
  const snap = await col(ctx.companyId, C.settlements).where("ownerPartyId", "==", scope.partyId).where("publishedToOwner", "==", true).limit(120).get();
  const list = snap.docs
    .map((d) => ({ ...(d.data() as Settlement), id: d.id }))
    .filter((s) => !s.archived && s.companyId === ctx.companyId)
    .sort((a, b) => b.period.localeCompare(a.period));
  return (
    <>
      <h1 className="mb-4">収支報告</h1>
      {list.length === 0 ? (
        <div className="card"><StateMessage kind="empty" message="公開された収支報告はまだありません" /></div>
      ) : (
        <div className="space-y-4">
          {list.map((s) => (
            <Card key={s.id} title={`${s.period} 分（${s.number}）`}>
              <DL
                items={[
                  ["状態", STATUS[s.status] ?? s.status],
                  ["回収済み賃料等", s.calc ? yen(s.calc.collectedTotal) : null],
                  ["管理料（税込）", s.calc ? yen(s.calc.fee + s.calc.feeTax) : null],
                  ["立替費用", s.calc ? yen(s.calc.expenses) : null],
                  ["前月繰越", s.calc ? yen(s.calc.carryIn) : null],
                  ["送金予定額", s.calc ? yen(s.calc.payable) : null],
                  ["送金記録額", yen(s.remitted)],
                ]}
              />
              {(s.expenses ?? []).length > 0 && (
                <table className="table mt-3">
                  <thead><tr><th>立替費用の内訳</th><th className="num">金額</th></tr></thead>
                  <tbody>{s.expenses.map((e, i) => <tr key={i}><td>{e.name}</td><td className="num">{yen(e.amount)}</td></tr>)}</tbody>
                </table>
              )}
              {s.calc?.basis?.length ? (
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer text-primary">計算根拠を表示</summary>
                  <ul className="mt-2 list-disc pl-5">{s.calc.basis.map((b, i) => <li key={i}>{b}</li>)}</ul>
                </details>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
