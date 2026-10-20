import type { ReactNode } from "react";
import type { ProposalItem } from "@/lib/types-deals";

const y = (n: number | null | undefined) => (n === null || n === undefined ? null : `${n.toLocaleString("ja-JP")}円`);

/** 提案物件の表示（提案時点のスナップショットのうち公開してよい項目のみ。社内メモ・所有者情報は表示しない） */
export function ProposalItemCard({ item, index, children }: { item: Partial<ProposalItem>; index: number; children?: ReactNode }) {
  const rows: [string, string | null | undefined][] = [
    ["所在地", item.address],
    ["間取り", item.layout],
    ["面積", item.area],
    ...(item.dealType === "sale"
      ? ([["価格", y(item.price)]] as [string, string | null][])
      : ([
          ["賃料", y(item.rent)],
          ["共益費・管理費", y(item.commonFee)],
          ["敷金", y(item.deposit)],
          ["礼金", y(item.keyMoney)],
        ] as [string, string | null][])),
    ["入居・引渡可能日", item.availableFrom],
  ];
  return (
    <section className="card">
      <div className="border-b border-line px-4 py-3">
        <p className="text-xs text-muted">候補 {index + 1}</p>
        <h2 className="text-base break-words">
          {item.propertyName ?? "（名称未設定）"}
          {item.unitNumber ? ` ${item.unitNumber}` : ""}
        </h2>
      </div>
      <div className="card-pad">
        <dl className="dl">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v ?? <span className="text-muted">未入力</span>}</dd>
            </div>
          ))}
        </dl>
        {item.comment && <p className="mt-3 rounded-md bg-bg p-3 text-sm break-words whitespace-pre-wrap">担当コメント: {item.comment}</p>}
        {item.snapshotAt && <p className="help mt-2">提案時点の条件です（{item.snapshotAt.slice(0, 10)}）。最新の条件は担当者にご確認ください。</p>}
        {children}
      </div>
    </section>
  );
}
