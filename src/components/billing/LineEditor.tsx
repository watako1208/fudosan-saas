"use client";
import { useState } from "react";
import Decimal from "decimal.js";
import { useFormCtx } from "@/components/EditForm";
import { computeTotals, lineAmount, Rounding, TaxSetting } from "@/lib/domain/money";

export interface EditableLine {
  itemCode: string;
  name: string;
  quantity: string;
  unitPrice: string;
  tax: TaxSetting;
}

export interface ItemTypeOption {
  code: string;
  name: string;
  tax: TaxSetting;
}

const DEC = /^-?\d+(\.\d+)?$/;
const CAT_LABEL = { taxable: "課税", exempt: "非課税", non_taxable: "不課税" } as const;

/**
 * 請求明細の編集（費目・名称・数量・単価・税）。数量・単価は十進文字列のまま送信し、金額はサーバーで再計算する。
 * 税設定は費目の初期値を入れ、明細ごとに変更できる（B10）。lockedLines は自動作成明細（編集不可）。
 */
export function LineEditor({
  itemTypes,
  initial,
  lockedLines = [],
  allowNegative = false,
  lineRounding = "floor",
  taxRounding = "floor",
  name = "lines",
}: {
  itemTypes: ItemTypeOption[];
  initial: EditableLine[];
  lockedLines?: { name: string; amount: number; formula: string | null; tax: TaxSetting }[];
  allowNegative?: boolean;
  lineRounding?: Rounding;
  taxRounding?: Rounding;
  name?: string;
}) {
  const { errors, markDirty } = useFormCtx();
  const [lines, setLines] = useState<EditableLine[]>(initial);
  const update = (i: number, patch: Partial<EditableLine>) => {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
    markDirty();
  };
  const amountOf = (l: EditableLine) => {
    const q = l.quantity.normalize("NFKC").replace(/,/g, "");
    const u = l.unitPrice.normalize("NFKC").replace(/[,¥円]/g, "");
    if (!DEC.test(q) || !DEC.test(u)) return null;
    return lineAmount({ quantity: q, unitPrice: u, tax: l.tax }, lineRounding);
  };
  const all = [
    ...lockedLines.map((l) => ({ amount: l.amount, tax: l.tax })),
    ...lines.map((l) => ({ amount: amountOf(l) ?? 0, tax: l.tax })),
  ];
  const totals = computeTotals(all, taxRounding);
  const add = () => {
    const t = itemTypes[0];
    setLines((ls) => [...ls, { itemCode: t?.code ?? "", name: t?.name ?? "", quantity: "1", unitPrice: "", tax: t?.tax ?? { category: "taxable", rate: "0.10", priceMode: "exclusive" } }]);
    markDirty();
  };

  return (
    <div className="sm:col-span-2 lg:col-span-3">
      <input type="hidden" name={name} value={JSON.stringify(lines)} />
      {errors[name] && <p className="field-error mb-2" role="alert">{errors[name]}</p>}
      <div className="overflow-x-auto">
        <table className="table min-w-[860px]">
          <thead>
            <tr>
              <th>費目</th>
              <th>名称</th>
              <th className="w-24">数量</th>
              <th className="w-32">単価（円）</th>
              <th className="w-56">税</th>
              <th className="num">金額</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lockedLines.map((l, i) => (
              <tr key={`locked-${i}`} className="bg-bg">
                <td colSpan={2}>
                  {l.name}
                  {l.formula && <div className="text-xs text-muted">{l.formula}</div>}
                </td>
                <td colSpan={3} className="text-xs text-muted">自動作成（契約条件から計算。変更は「再計算」で行います）</td>
                <td className="num">{l.amount.toLocaleString()}円</td>
                <td />
              </tr>
            ))}
            {lines.map((l, i) => {
              const amt = amountOf(l);
              return (
                <tr key={i}>
                  <td>
                    <select
                      className="input"
                      aria-label={`${i + 1}行目の費目`}
                      value={l.itemCode}
                      onChange={(e) => {
                        const t = itemTypes.find((x) => x.code === e.target.value);
                        update(i, { itemCode: e.target.value, ...(t ? { tax: t.tax, name: l.name && l.name !== itemTypes.find((x) => x.code === l.itemCode)?.name ? l.name : t.name } : {}) });
                      }}
                    >
                      <option value="">選択</option>
                      {itemTypes.map((t) => (
                        <option key={t.code} value={t.code}>{t.name}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input className="input" aria-label={`${i + 1}行目の名称`} value={l.name} onChange={(e) => update(i, { name: e.target.value })} />
                  </td>
                  <td>
                    <input className="input" inputMode="decimal" aria-label={`${i + 1}行目の数量`} value={l.quantity} onChange={(e) => update(i, { quantity: e.target.value })} />
                  </td>
                  <td>
                    <input className="input" inputMode={allowNegative ? "text" : "decimal"} aria-label={`${i + 1}行目の単価`} value={l.unitPrice} onChange={(e) => update(i, { unitPrice: e.target.value })} />
                  </td>
                  <td>
                    <div className="flex gap-1">
                      <select
                        className="input !px-1"
                        aria-label={`${i + 1}行目の税区分`}
                        value={l.tax.category}
                        onChange={(e) => update(i, { tax: { ...l.tax, category: e.target.value as TaxSetting["category"], rate: e.target.value === "taxable" ? (l.tax.rate === "0" ? "0.10" : l.tax.rate) : "0" } })}
                      >
                        {Object.entries(CAT_LABEL).map(([k, v]) => (
                          <option key={k} value={k}>{v}</option>
                        ))}
                      </select>
                      {l.tax.category === "taxable" && (
                        <>
                          <select className="input !px-1" aria-label={`${i + 1}行目の税率`} value={l.tax.rate} onChange={(e) => update(i, { tax: { ...l.tax, rate: e.target.value } })}>
                            <option value="0.10">10%</option>
                            <option value="0.08">8%</option>
                          </select>
                          <select className="input !px-1" aria-label={`${i + 1}行目の税込税抜`} value={l.tax.priceMode} onChange={(e) => update(i, { tax: { ...l.tax, priceMode: e.target.value as TaxSetting["priceMode"] } })}>
                            <option value="exclusive">税抜</option>
                            <option value="inclusive">税込</option>
                          </select>
                        </>
                      )}
                    </div>
                  </td>
                  <td className="num">{amt === null ? <span className="text-danger">数値を確認</span> : `${amt.toLocaleString()}円`}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        setLines((ls) => ls.filter((_, j) => j !== i));
                        markDirty();
                      }}
                    >
                      削除
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={add}>＋ 明細を追加</button>
      <div className="mt-4 ml-auto max-w-sm text-sm">
        <table className="table">
          <tbody>
            {totals.breakdown.map((b) => (
              <tr key={b.key}>
                <td>{CAT_LABEL[b.category]}{b.category === "taxable" ? ` ${new Decimal(b.rate).mul(100).toString()}%` : ""} 対象</td>
                <td className="num">{b.base.toLocaleString()}円</td>
                <td className="num">税 {b.tax.toLocaleString()}円</td>
              </tr>
            ))}
            <tr>
              <td className="font-semibold">合計（税込）</td>
              <td colSpan={2} className="num font-semibold">{totals.total.toLocaleString()}円</td>
            </tr>
          </tbody>
        </table>
        <p className="help">金額は保存時にサーバーで再計算します（税は税率別に集計して計算）。</p>
      </div>
    </div>
  );
}
