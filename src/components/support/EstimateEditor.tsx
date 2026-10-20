"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { computeEstimate, EstimateLineInput, BURDEN_PARTY } from "@/lib/labels-support";
import type { Rounding } from "@/lib/domain/money";
import type { ActionResult } from "@/lib/server/action";

type Party = "lessor" | "lessee" | "company" | "other";
const PARTIES: Party[] = ["lessor", "lessee", "company", "other"];

interface Row {
  name: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  taxCategory: "taxable" | "exempt" | "non_taxable";
  taxRate: string;
  priceMode: "exclusive" | "inclusive";
  burden: Record<Party, string>;
}

const emptyRow = (): Row => ({ name: "", quantity: "1", unit: "式", unitPrice: "", taxCategory: "taxable", taxRate: "0.10", priceMode: "exclusive", burden: { lessor: "", lessee: "", company: "", other: "" } });

function toInput(r: Row): EstimateLineInput {
  return {
    name: r.name,
    quantity: r.quantity.normalize("NFKC").trim(),
    unit: r.unit,
    unitPrice: r.unitPrice.normalize("NFKC").replace(/[,¥円\s]/g, ""),
    tax: { category: r.taxCategory, rate: r.taxCategory === "taxable" ? r.taxRate : "0", priceMode: r.priceMode },
    burden: PARTIES.filter((p) => r.burden[p].trim() !== "").map((p) => ({ party: p, amount: Number(r.burden[p].normalize("NFKC").replace(/[,¥円\s]/g, "")) })),
  };
}

function fromLine(l: EstimateLineInput): Row {
  const b: Record<Party, string> = { lessor: "", lessee: "", company: "", other: "" };
  for (const x of l.burden ?? []) b[x.party] = String((Number(b[x.party]) || 0) + x.amount);
  return {
    name: l.name, quantity: l.quantity, unit: l.unit, unitPrice: l.unitPrice,
    taxCategory: l.tax.category, taxRate: l.tax.rate || "0.10", priceMode: l.tax.priceMode, burden: b,
  };
}

const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;

/**
 * 見積明細の表形式エディタ（数量・単位・単価・税・費用負担を独立項目）。合計はその場で再計算する。
 * vendorMode では費用負担を入力しない（社内で判断する）。
 */
export function EstimateEditor({
  repairId,
  initialLines,
  version,
  lineRounding,
  taxRounding,
  action,
  vendorMode = false,
  saveLabel = "下書き保存",
}: {
  repairId: string;
  initialLines: EstimateLineInput[];
  version?: number;
  lineRounding: Rounding;
  taxRounding: Rounding;
  action: (v: Record<string, unknown>) => Promise<ActionResult<unknown>>;
  vendorMode?: boolean;
  saveLabel?: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(initialLines.length ? initialLines.map(fromLine) : [emptyRow()]);
  const [state, setState] = useState<"clean" | "dirty" | "saving" | "saved" | "failed">("clean");
  const [errors, setErrors] = useState<string[]>([]);
  const rid = useRef(crypto.randomUUID());
  const calc = useMemo(() => computeEstimate(rows.map(toInput), lineRounding, taxRounding), [rows, lineRounding, taxRounding]);

  const set = (i: number, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    setState("dirty");
  };
  const setBurden = (i: number, p: Party, v: string) => set(i, { burden: { ...rows[i].burden, [p]: v } });

  const save = async () => {
    setState("saving");
    setErrors([]);
    try {
      const r = await action({ repairId, lines: JSON.stringify(rows.map(toInput)), _version: version ?? null, _requestId: rid.current });
      if (!r.ok) {
        setState("failed");
        setErrors(r.code === "conflict" ? ["他の利用者が先に見積を更新しました。画面を再読み込みしてから入力し直してください。"] : r.errors?.length ? r.errors : [r.error]);
        return;
      }
      rid.current = crypto.randomUUID();
      setState("saved");
      router.refresh();
    } catch {
      setState("failed");
      setErrors(["通信に失敗しました。入力内容は保持されています。再試行してください。"]);
    }
  };

  const label = { clean: "変更なし", dirty: "未保存", saving: "保存中…", saved: "保存済み", failed: "保存失敗" }[state];

  return (
    <div>
      {errors.length > 0 && (
        <div className="mb-3 rounded-md border border-danger/30 bg-danger-soft p-3 text-sm text-danger" role="alert">
          <ul className="list-disc pl-5">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="table min-w-[960px]">
          <thead>
            <tr>
              <th>#</th>
              <th>項目名</th>
              <th>数量</th>
              <th>単位</th>
              <th>単価（円）</th>
              <th>税</th>
              <th className="num">金額</th>
              {!vendorMode && PARTIES.map((p) => <th key={p}>{BURDEN_PARTY[p].label}負担</th>)}
              {!vendorMode && <th>負担の一致</th>}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const c = calc.lines[i];
              return (
                <tr key={i}>
                  <td className="text-muted">{i + 1}</td>
                  <td><input className="input min-w-40" value={r.name} onChange={(e) => set(i, { name: e.target.value })} aria-label={`${i + 1}行目 項目名`} /></td>
                  <td><input className="input w-20" inputMode="decimal" value={r.quantity} onChange={(e) => set(i, { quantity: e.target.value })} aria-label={`${i + 1}行目 数量`} /></td>
                  <td><input className="input w-16" value={r.unit} onChange={(e) => set(i, { unit: e.target.value })} aria-label={`${i + 1}行目 単位`} /></td>
                  <td><input className="input w-28" inputMode="decimal" value={r.unitPrice} onChange={(e) => set(i, { unitPrice: e.target.value })} aria-label={`${i + 1}行目 単価`} /></td>
                  <td>
                    <select
                      className="input w-36"
                      value={`${r.taxCategory}:${r.taxRate}:${r.priceMode}`}
                      onChange={(e) => {
                        const [taxCategory, taxRate, priceMode] = e.target.value.split(":") as [Row["taxCategory"], string, Row["priceMode"]];
                        set(i, { taxCategory, taxRate, priceMode });
                      }}
                      aria-label={`${i + 1}行目 税`}
                    >
                      <option value="taxable:0.10:exclusive">課税10%（税抜）</option>
                      <option value="taxable:0.10:inclusive">課税10%（税込）</option>
                      <option value="taxable:0.08:exclusive">課税8%（税抜）</option>
                      <option value="exempt:0:exclusive">非課税</option>
                      <option value="non_taxable:0:exclusive">不課税</option>
                    </select>
                  </td>
                  <td className="num font-semibold">{yen(c.amount)}</td>
                  {!vendorMode && PARTIES.map((p) => (
                    <td key={p}>
                      <input className="input w-24" inputMode="numeric" value={r.burden[p]} placeholder="—" onChange={(e) => setBurden(i, p, e.target.value)} aria-label={`${i + 1}行目 ${BURDEN_PARTY[p].label}負担額`} />
                    </td>
                  ))}
                  {!vendorMode && (
                    <td>
                      {c.burdenMatches ? (
                        <span className="text-sm text-ok">一致</span>
                      ) : (
                        <span className="text-sm text-danger">不一致（負担計 {yen(c.burdenTotal)}）</span>
                      )}
                      <select
                        className="input mt-1 !min-h-8 w-32 text-xs"
                        value=""
                        onChange={(e) => {
                          const p = e.target.value as Party;
                          if (!p) return;
                          set(i, { burden: { lessor: "", lessee: "", company: "", other: "", [p]: String(c.amount) } });
                        }}
                        aria-label={`${i + 1}行目 全額を割当`}
                      >
                        <option value="">全額を割当…</option>
                        {PARTIES.map((p) => <option key={p} value={p}>{BURDEN_PARTY[p].label}</option>)}
                      </select>
                    </td>
                  )}
                  <td>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setRows(rows.filter((_, j) => j !== i)); setState("dirty"); }} aria-label={`${i + 1}行目を削除`}>
                      削除
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={() => { setRows([...rows, emptyRow()]); setState("dirty"); }}>
        ＋ 明細を追加
      </button>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">小計（税抜）</dt><dd className="num">{yen(calc.subtotal)}</dd>
          <dt className="text-muted">消費税</dt><dd className="num">{yen(calc.tax)}</dd>
          <dt className="font-semibold">合計</dt><dd className="num font-semibold">{yen(calc.total)}</dd>
        </dl>
        {!vendorMode && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {PARTIES.map((p) => (
              <div key={p} className="contents">
                <dt className="text-muted">{BURDEN_PARTY[p].label}負担 計</dt>
                <dd className="num">{yen(calc.burdenByParty[p] ?? 0)}</dd>
              </div>
            ))}
            <dt className="col-span-2 help">負担額は明細金額（税抜・税込は明細の設定どおり）に対して入力します。全明細で一致しないと承認申請できません。</dt>
          </dl>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-primary" onClick={save} disabled={state === "saving"}>
          {state === "saving" ? "保存中…" : saveLabel}
        </button>
        <span className={`text-sm font-semibold ${state === "failed" ? "text-danger" : state === "dirty" ? "text-warn" : state === "saved" ? "text-ok" : "text-muted"}`} aria-live="polite">
          {label}
        </span>
      </div>
    </div>
  );
}
