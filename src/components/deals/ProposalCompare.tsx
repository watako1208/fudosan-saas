import { ReactNode } from "react";
import { Badge } from "@/components/ui";
import { lbl, tone } from "@/lib/labels";
import { REACTION_KIND } from "@/lib/labels-deals";
import { yen } from "@/lib/domain/money";
import { formatDateTimeJst } from "@/lib/domain/dates";
import type { Proposal, ProposalItem } from "@/lib/types-deals";

const dash = (v: string | null | undefined) => (v ? v : "—");

/** 物件比較表（候補を列、項目を行に並べる）。印刷ページでも利用 */
export function ProposalCompare({ p, showReactions = true }: { p: Proposal; showReactions?: boolean }) {
  const items = p.items;
  const anySale = items.some((i) => i.dealType === "sale");
  const anyRent = items.some((i) => i.dealType !== "sale");
  const rows: [string, (it: ProposalItem, i: number) => ReactNode][] = [
    ["物件", (it) => <span className="font-semibold">{it.propertyName}{it.unitNumber ? ` ${it.unitNumber}` : ""}</span>],
    ["物件番号", (it) => it.propertyNumber],
    ["所在地", (it) => dash(it.address)],
    ["間取り", (it) => dash(it.layout)],
    ["面積", (it) => dash(it.area)],
    ...(anyRent
      ? ([
          ["賃料", (it: ProposalItem) => (it.dealType === "sale" ? "—" : yen(it.rent))],
          ["共益費・管理費", (it: ProposalItem) => (it.dealType === "sale" ? "—" : yen(it.commonFee))],
          ["敷金", (it: ProposalItem) => (it.dealType === "sale" ? "—" : yen(it.deposit))],
          ["礼金", (it: ProposalItem) => (it.dealType === "sale" ? "—" : yen(it.keyMoney))],
        ] as [string, (it: ProposalItem, i: number) => ReactNode][])
      : []),
    ...(anySale ? ([["価格", (it: ProposalItem) => (it.dealType === "sale" ? yen(it.price) : "—")]] as [string, (it: ProposalItem, i: number) => ReactNode][]) : []),
    ["入居・引渡可能日", (it) => dash(it.availableFrom)],
    ["担当コメント", (it) => <span className="whitespace-pre-wrap">{dash(it.comment)}</span>],
    ["条件の取得日時", (it) => <span className="text-xs">{formatDateTimeJst(it.snapshotAt)}{!it.listingId && "（募集条件なし）"}</span>],
  ];
  if (showReactions) {
    rows.push([
      "顧客の反応",
      (_it, i) => {
        const rs = (p.reactions ?? []).filter((r) => r.itemIndex === i);
        if (!rs.length) return <span className="text-muted">—</span>;
        return (
          <ul className="space-y-0.5">
            {rs.map((r, j) => (
              <li key={j}>
                <Badge tone={tone(REACTION_KIND, r.kind)}>{lbl(REACTION_KIND, r.kind)}</Badge>
                {r.reason && <span className="ml-1 text-xs">{r.reason}</span>}
              </li>
            ))}
          </ul>
        );
      },
    ]);
  }
  if (items.length === 0) return <p className="text-muted">候補物件がありません</p>;
  return (
    <div className="overflow-x-auto">
      <table className="table compare-table">
        <thead>
          <tr>
            <th className="w-32">項目</th>
            {items.map((it, i) => <th key={i}>候補{i + 1}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, fn]) => (
            <tr key={label}>
              <th scope="row" className="!bg-[#f8f9fb] text-left">{label}</th>
              {items.map((it, i) => <td key={i} className={["賃料", "共益費・管理費", "敷金", "礼金", "価格"].includes(label) ? "num" : ""}>{fn(it, i)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
