import { notFound } from "next/navigation";
import { requireStaffPage } from "@/lib/server/session";
import { getDoc, getMany, findDocs } from "@/lib/server/repo";
import { companyName } from "@/lib/server/lookups";
import { itemTypeList, SettlementExtra } from "@/lib/server/jobs/billing";
import { C, Party, Property, Remittance, Settlement } from "@/lib/types";
import { PrintView } from "@/components/billing/PrintView";
import { SETTLEMENT_STATUS } from "@/lib/labels-billing";
import { lbl } from "@/lib/labels";
import { yen } from "@/lib/domain/money";

export const metadata = { title: "オーナー収支報告（印刷）" };

export default async function SettlementPrint({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaffPage("settlement.read");
  const { id } = await params;
  const s = await getDoc<Settlement & SettlementExtra>(ctx, C.settlements, id);
  if (!s) notFound();
  const owner = await getDoc<Party>(ctx, C.parties, s.ownerPartyId);
  const props = await getMany<Property>(ctx, C.properties, s.propertyIds);
  const owners = await getMany<Party>(ctx, C.parties, s.ownerSplit.map((o) => o.ownerId));
  const remits = (await findDocs<Remittance>(ctx, C.remittances, [["settlementId", "==", id]], 200)).sort((a, b) => a.date.localeCompare(b.date));
  const types = await itemTypeList(ctx);
  const byKey = new Map<string, { prop: string; item: string; amount: number }>();
  for (const r of s.collectedDetail ?? []) {
    const k = `${r.propertyId}|${r.itemCode}`;
    const g = byKey.get(k) ?? { prop: props.get(r.propertyId)?.name ?? r.propertyId, item: types.find((t) => t.code === r.itemCode)?.name ?? r.itemCode, amount: 0 };
    g.amount += r.amount;
    byKey.set(k, g);
  }
  const confirmed = ["confirmed", "partially_remitted", "remitted"].includes(s.status);
  return (
    <PrintView backHref={`/settlements/${id}`}>
      {!confirmed && (
        <p style={{ border: "2px solid #b91c1c", color: "#b91c1c", padding: "4px 8px", fontWeight: 700, marginBottom: 8 }}>
          {lbl(SETTLEMENT_STATUS, s.status)} — 確定前の精算書です
        </p>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
        <div>
          <h1 style={{ fontSize: "18pt", fontWeight: 700 }}>オーナー収支報告書（{s.period}）</h1>
          <p style={{ marginTop: 12, fontSize: "13pt", borderBottom: "1px solid #333" }}>{owner?.name ?? ""} 様</p>
          <p style={{ marginTop: 4 }}>対象物件: {s.propertyIds.map((p) => props.get(p)?.name ?? p).join("、")}</p>
        </div>
        <div style={{ textAlign: "right" }}>
          <p>精算番号: {s.number}</p>
          {s.correctionOf && <p>（訂正精算）</p>}
          <p style={{ marginTop: 8, fontWeight: 700 }}>{await companyName(ctx.companyId)}</p>
        </div>
      </div>
      <h2 style={{ marginTop: 16, fontSize: "12pt", fontWeight: 700 }}>収支</h2>
      <table>
        <tbody>
          <tr><th>回収済み家賃等</th><td className="r">{yen(s.calc?.collectedTotal ?? 0)}</td></tr>
          <tr><th>管理料</th><td className="r">− {yen(s.calc?.fee ?? 0)}</td></tr>
          <tr><th>管理料消費税</th><td className="r">− {yen(s.calc?.feeTax ?? 0)}</td></tr>
          {s.expenses.map((e, i) => (
            <tr key={i}><th>立替費用: {e.name}</th><td className="r">− {yen(e.amount)}</td></tr>
          ))}
          <tr><th>前回繰越</th><td className="r">{yen(s.calc?.carryIn ?? 0)}</td></tr>
          <tr><th>送金予定額</th><td className="r" style={{ fontWeight: 700 }}>{yen(s.calc?.payable ?? 0)}</td></tr>
          {(s.calc?.carryOut ?? 0) < 0 && <tr><th>次回へ繰越</th><td className="r">{yen(s.calc!.carryOut)}</td></tr>}
        </tbody>
      </table>
      <h2 style={{ marginTop: 16, fontSize: "12pt", fontWeight: 700 }}>回収内訳</h2>
      <table>
        <thead><tr><th>物件</th><th>費目</th><th className="r">回収額</th></tr></thead>
        <tbody>
          {byKey.size === 0 && <tr><td colSpan={3}>回収済みの入金はありません</td></tr>}
          {[...byKey.values()].map((g, i) => (
            <tr key={i}><td>{g.prop}</td><td>{g.item}</td><td className="r">{yen(g.amount)}</td></tr>
          ))}
        </tbody>
      </table>
      <h2 style={{ marginTop: 16, fontSize: "12pt", fontWeight: 700 }}>計算根拠</h2>
      <ul style={{ paddingLeft: 18, listStyle: "disc" }}>
        {(s.calc?.basis ?? []).map((b, i) => <li key={i}>{b}</li>)}
      </ul>
      {s.ownerSplit.length > 1 && (
        <>
          <h2 style={{ marginTop: 16, fontSize: "12pt", fontWeight: 700 }}>共有所有者への送金配分</h2>
          <table>
            <thead><tr><th>送金先</th><th className="r">送金予定</th></tr></thead>
            <tbody>
              {s.ownerSplit.map((o) => <tr key={o.ownerId}><td>{owners.get(o.ownerId)?.name ?? ""}</td><td className="r">{yen(o.amount)}</td></tr>)}
            </tbody>
          </table>
        </>
      )}
      <h2 style={{ marginTop: 16, fontSize: "12pt", fontWeight: 700 }}>送金記録</h2>
      <table>
        <thead><tr><th>送金日</th><th>送金先</th><th className="r">金額</th></tr></thead>
        <tbody>
          {remits.length === 0 && <tr><td colSpan={3}>送金記録はまだありません</td></tr>}
          {remits.map((r) => <tr key={r.id}><td>{r.date}</td><td>{owners.get(r.ownerPartyId)?.name ?? ""}</td><td className="r">{yen(r.amount)}</td></tr>)}
          <tr><th colSpan={2}>送金予定との差額</th><td className="r">{yen((s.calc?.payable ?? 0) - s.remitted)}</td></tr>
        </tbody>
      </table>
    </PrintView>
  );
}
