"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFormCtx } from "@/components/EditForm";
import { firstMonthProration } from "@/lib/domain/contracts";
import { yen } from "@/lib/domain/money";
import type { TaxSetting, ProrationSetting } from "@/lib/domain/money";
import { TAX_CATEGORY, PRICE_MODE, PRORATION_METHOD, ROUNDING, FIXED30_COUNTING } from "@/lib/labels-contracts";
import { opts } from "@/lib/labels";

export interface ItemTypeOption {
  code: string;
  name: string;
  kind: "monthly" | "initial" | "one_time" | "deposit";
  tax: TaxSetting;
  proration: ProrationSetting;
}

interface MonthlyRow {
  code: string;
  name: string;
  amount: string;
  tax: TaxSetting;
  proration: ProrationSetting;
}

interface InitialRow {
  code: string;
  name: string;
  amount: string;
  tax: TaxSetting;
}

const amt = (v: unknown) => (v === null || v === undefined ? "" : String(v));

function TaxFields({ id, tax, onChange }: { id: string; tax: TaxSetting; onChange: (t: TaxSetting) => void }) {
  return (
    <>
      <div>
        <label className="label" htmlFor={`${id}-taxcat`}>税区分</label>
        <select id={`${id}-taxcat`} className="input" value={tax.category} onChange={(e) => onChange({ ...tax, category: e.target.value as TaxSetting["category"], rate: e.target.value === "taxable" ? (tax.rate === "0" ? "0.10" : tax.rate) : "0" })}>
          {opts(TAX_CATEGORY).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor={`${id}-rate`}>税率</label>
        <input id={`${id}-rate`} className="input" inputMode="decimal" disabled={tax.category !== "taxable"} value={tax.category === "taxable" ? tax.rate : "0"} onChange={(e) => onChange({ ...tax, rate: e.target.value })} placeholder="0.10" />
        <p className="help">小数で入力（10% → 0.10）</p>
      </div>
      <div>
        <label className="label" htmlFor={`${id}-mode`}>金額の扱い</label>
        <select id={`${id}-mode`} className="input" value={tax.priceMode} onChange={(e) => onChange({ ...tax, priceMode: e.target.value as TaxSetting["priceMode"] })}>
          {opts(PRICE_MODE).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
    </>
  );
}

/** 月額費用（費目別の税・日割り設定を版へ保存: B07/B10）。開始月の日割りを計算式つきで確認表示（B09） */
export function MonthlyItemsEditor({ itemTypes, name = "monthlyItems" }: { itemTypes: ItemTypeOption[]; name?: string }) {
  const { initial, errors, markDirty } = useFormCtx();
  const monthlyTypes = itemTypes.filter((t) => t.kind === "monthly");
  const [rows, setRows] = useState<MonthlyRow[]>(() =>
    ((initial[name] as MonthlyRow[] | undefined) ?? []).map((r) => ({ ...r, amount: amt(r.amount) })),
  );
  const hidden = useRef<HTMLInputElement>(null);
  const [period, setPeriod] = useState<{ start: string; end: string }>({ start: amt(initial.start), end: amt(initial.end) });

  useEffect(() => {
    const form = hidden.current?.form;
    if (!form) return;
    const read = () => {
      const s = form.elements.namedItem("start") as HTMLInputElement | null;
      const e = form.elements.namedItem("end") as HTMLInputElement | null;
      setPeriod({ start: s?.value ?? "", end: e?.value ?? "" });
    };
    form.addEventListener("input", read);
    form.addEventListener("change", read);
    return () => {
      form.removeEventListener("input", read);
      form.removeEventListener("change", read);
    };
  }, []);

  const update = (i: number, patch: Partial<MonthlyRow>) => {
    setRows(rows.map((r, j) => (i === j ? { ...r, ...patch } : r)));
    markDirty();
  };
  const preview = useMemo(
    () =>
      period.start
        ? firstMonthProration(
            rows.map((r) => ({ code: r.code, name: r.name, amount: r.amount.trim() === "" || !Number.isInteger(Number(r.amount)) ? null : Number(r.amount), proration: r.proration })),
            period.start,
            period.end || null,
          )
        : [],
    [rows, period],
  );

  return (
    <div className="sm:col-span-2 lg:col-span-3">
      <input ref={hidden} type="hidden" name={name} value={JSON.stringify(rows)} />
      {rows.length === 0 && <p className="rounded-md border border-dashed border-line px-3 py-4 text-sm text-muted">月額費用が登録されていません。</p>}
      <div className="space-y-3">
        {rows.map((r, i) => {
          const id = `${name}-${i}`;
          return (
            <fieldset key={i} className="rounded-md border border-line p-3">
              <legend className="px-1 text-sm font-semibold">{r.name || "（費目未選択）"}</legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="label" htmlFor={`${id}-code`}>費目</label>
                  <select
                    id={`${id}-code`}
                    className="input"
                    value={r.code}
                    onChange={(e) => {
                      const t = itemTypes.find((x) => x.code === e.target.value);
                      update(i, t ? { code: t.code, name: t.name, tax: t.tax, proration: t.proration } : { code: e.target.value });
                    }}
                  >
                    <option value="">選択してください</option>
                    {monthlyTypes.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
                    {r.code && !monthlyTypes.some((t) => t.code === r.code) && <option value={r.code}>{r.name}（{r.code}）</option>}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor={`${id}-name`}>表示名</label>
                  <input id={`${id}-name`} className="input" value={r.name} onChange={(e) => update(i, { name: e.target.value })} />
                </div>
                <div>
                  <label className="label" htmlFor={`${id}-amount`}>月額（円）</label>
                  <input id={`${id}-amount`} className="input" inputMode="numeric" value={r.amount} placeholder="未入力" onChange={(e) => update(i, { amount: e.target.value.replace(/[,¥円]/g, "") })} />
                </div>
                <TaxFields id={id} tax={r.tax} onChange={(tax) => update(i, { tax })} />
                <div>
                  <label className="label" htmlFor={`${id}-pm`}>日割り方式</label>
                  <select
                    id={`${id}-pm`}
                    className="input"
                    value={r.proration.method}
                    onChange={(e) => {
                      const method = e.target.value as ProrationSetting["method"];
                      update(i, { proration: { ...r.proration, method, fixed30Counting: method === "fixed30" ? r.proration.fixed30Counting ?? "calendar_cap30" : undefined } });
                    }}
                  >
                    {opts(PRORATION_METHOD).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor={`${id}-pr`}>日割りの円未満</label>
                  <select id={`${id}-pr`} className="input" value={r.proration.rounding} onChange={(e) => update(i, { proration: { ...r.proration, rounding: e.target.value as ProrationSetting["rounding"] } })}>
                    {opts(ROUNDING).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                {r.proration.method === "fixed30" && (
                  <div>
                    <label className="label" htmlFor={`${id}-f30`}>30日固定の日数の数え方</label>
                    <select id={`${id}-f30`} className="input" value={r.proration.fixed30Counting ?? "calendar_cap30"} onChange={(e) => update(i, { proration: { ...r.proration, fixed30Counting: e.target.value as ProrationSetting["fixed30Counting"] } })}>
                      {opts(FIXED30_COUNTING).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                )}
              </div>
              <div className="mt-2 text-right">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setRows(rows.filter((_, j) => j !== i)); markDirty(); }}>この費目を削除</button>
              </div>
            </fieldset>
          );
        })}
      </div>
      <button
        type="button"
        className="btn btn-secondary btn-sm mt-3"
        onClick={() => {
          const t = monthlyTypes.find((x) => !rows.some((r) => r.code === x.code));
          setRows([...rows, t ? { code: t.code, name: t.name, amount: "", tax: t.tax, proration: t.proration } : { code: "", name: "", amount: "", tax: { category: "exempt", rate: "0", priceMode: "exclusive" }, proration: { method: "actual", rounding: "floor" } }]);
          markDirty();
        }}
      >
        ＋ 月額費用を追加
      </button>
      {errors[name] && <p className="field-error">{errors[name]}</p>}

      <div className="mt-4 rounded-md border border-line bg-bg p-3">
        <p className="text-sm font-semibold">初月の日割り確認</p>
        {!period.start ? (
          <p className="help">契約開始日を入力すると、開始月の日割り額と計算式を表示します。</p>
        ) : preview.length === 0 ? (
          <p className="help">月額費用を追加すると表示します。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table mt-2 bg-surface">
              <thead>
                <tr><th>費目</th><th>対象期間</th><th className="num">月額</th><th>計算式</th><th className="num">初月額</th></tr>
              </thead>
              <tbody>
                {preview.map((p, i) => (
                  <tr key={i}>
                    <td>{p.name || "（費目未選択）"}</td>
                    <td className="whitespace-nowrap">{p.from}〜{p.to}</td>
                    <td className="num">{p.error === "金額未入力" ? "未入力" : yen(p.monthly)}</td>
                    <td>{p.result ? p.result.formula : <span className="text-muted">{p.error}</span>}</td>
                    <td className="num font-semibold">{p.result ? yen(p.result.amount) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/** 初期費用（礼金・仲介手数料・鍵交換など）。敷金は預り金のため別項目で入力する */
export function InitialItemsEditor({ itemTypes, name = "initialItems" }: { itemTypes: ItemTypeOption[]; name?: string }) {
  const { initial, errors, markDirty } = useFormCtx();
  const types = itemTypes.filter((t) => t.kind === "initial" || t.kind === "one_time");
  const [rows, setRows] = useState<InitialRow[]>(() => ((initial[name] as InitialRow[] | undefined) ?? []).map((r) => ({ ...r, amount: amt(r.amount) })));
  const update = (i: number, patch: Partial<InitialRow>) => {
    setRows(rows.map((r, j) => (i === j ? { ...r, ...patch } : r)));
    markDirty();
  };
  return (
    <div className="sm:col-span-2 lg:col-span-3">
      <input type="hidden" name={name} value={JSON.stringify(rows)} />
      {rows.length === 0 && <p className="rounded-md border border-dashed border-line px-3 py-4 text-sm text-muted">初期費用が登録されていません。</p>}
      <div className="space-y-3">
        {rows.map((r, i) => {
          const id = `${name}-${i}`;
          return (
            <fieldset key={i} className="rounded-md border border-line p-3">
              <legend className="px-1 text-sm font-semibold">{r.name || "（費目未選択）"}</legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="label" htmlFor={`${id}-code`}>費目</label>
                  <select
                    id={`${id}-code`}
                    className="input"
                    value={r.code}
                    onChange={(e) => {
                      const t = itemTypes.find((x) => x.code === e.target.value);
                      update(i, t ? { code: t.code, name: t.name, tax: t.tax } : { code: e.target.value });
                    }}
                  >
                    <option value="">選択してください</option>
                    {types.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
                    {r.code && !types.some((t) => t.code === r.code) && <option value={r.code}>{r.name}（{r.code}）</option>}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor={`${id}-name`}>表示名</label>
                  <input id={`${id}-name`} className="input" value={r.name} onChange={(e) => update(i, { name: e.target.value })} />
                </div>
                <div>
                  <label className="label" htmlFor={`${id}-amount`}>金額（円）</label>
                  <input id={`${id}-amount`} className="input" inputMode="numeric" value={r.amount} placeholder="未入力" onChange={(e) => update(i, { amount: e.target.value.replace(/[,¥円]/g, "") })} />
                </div>
                <TaxFields id={id} tax={r.tax} onChange={(tax) => update(i, { tax })} />
              </div>
              <div className="mt-2 text-right">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setRows(rows.filter((_, j) => j !== i)); markDirty(); }}>この費目を削除</button>
              </div>
            </fieldset>
          );
        })}
      </div>
      <button
        type="button"
        className="btn btn-secondary btn-sm mt-3"
        onClick={() => {
          const t = types.find((x) => !rows.some((r) => r.code === x.code));
          setRows([...rows, t ? { code: t.code, name: t.name, amount: "", tax: t.tax } : { code: "", name: "", amount: "", tax: { category: "taxable", rate: "0.10", priceMode: "exclusive" } }]);
          markDirty();
        }}
      >
        ＋ 初期費用を追加
      </button>
      {errors[name] && <p className="field-error">{errors[name]}</p>}
    </div>
  );
}
