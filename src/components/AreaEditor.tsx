"use client";
import { useState } from "react";
import { useFormCtx } from "./EditForm";
import type { AreaValue } from "@/lib/types";
import { AREA_KIND, AREA_BASIS, opts } from "@/lib/labels";

/** 面積: 種類・基準・単位を行ごとに持ち、異なる基準の値を統合しない */
export function AreaEditor({ name = "areas", label = "面積" }: { name?: string; label?: string }) {
  const { initial, errors, markDirty } = useFormCtx();
  const [rows, setRows] = useState<AreaValue[]>(() => (Array.isArray(initial[name]) ? (initial[name] as AreaValue[]) : []));
  const update = (i: number, patch: Partial<AreaValue>) => {
    setRows(rows.map((r, j) => (i === j ? { ...r, ...patch } : r)));
    markDirty();
  };
  return (
    <div className="sm:col-span-2 lg:col-span-3">
      <span className="label">{label}</span>
      <input type="hidden" name={name} value={JSON.stringify(rows)} />
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-2 gap-2 rounded-md border border-line p-2 sm:grid-cols-[1fr_1fr_1fr_90px_1.5fr_auto]">
            <select className="input" aria-label="面積の種類" value={r.kind} onChange={(e) => update(i, { kind: e.target.value as AreaValue["kind"] })}>
              {opts(AREA_KIND).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select className="input" aria-label="面積の基準" value={r.basis} onChange={(e) => update(i, { basis: e.target.value as AreaValue["basis"] })}>
              {opts(AREA_BASIS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <input className="input" aria-label="数値" inputMode="decimal" value={r.value} onChange={(e) => update(i, { value: e.target.value })} placeholder="例: 25.32" />
            <select className="input" aria-label="単位" value={r.unit} onChange={(e) => update(i, { unit: e.target.value as AreaValue["unit"] })}>
              <option value="m2">㎡</option>
              <option value="tsubo">坪</option>
            </select>
            <input className="input" aria-label="根拠・備考" value={r.note ?? ""} onChange={(e) => update(i, { note: e.target.value })} placeholder="根拠資料・備考" />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setRows(rows.filter((_, j) => j !== i)); markDirty(); }}>削除</button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="btn btn-secondary btn-sm mt-2"
        onClick={() => {
          setRows([...rows, { kind: "exclusive", basis: "wall_center", value: "", unit: "m2", note: null }]);
          markDirty();
        }}
      >
        ＋ 面積を追加
      </button>
      {errors[name] && <p className="field-error">{errors[name]}</p>}
    </div>
  );
}

export function AccessEditor({ name = "access" }: { name?: string }) {
  const { initial, markDirty } = useFormCtx();
  type A = { line: string; station: string; walkMin: number | null };
  const [rows, setRows] = useState<A[]>(() => (Array.isArray(initial[name]) ? (initial[name] as A[]) : []));
  const update = (i: number, patch: Partial<A>) => {
    setRows(rows.map((r, j) => (i === j ? { ...r, ...patch } : r)));
    markDirty();
  };
  return (
    <div className="sm:col-span-2 lg:col-span-3">
      <span className="label">交通</span>
      <input type="hidden" name={name} value={JSON.stringify(rows)} />
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_100px_auto] gap-2">
            <input className="input" aria-label="路線" value={r.line} onChange={(e) => update(i, { line: e.target.value })} placeholder="路線" />
            <input className="input" aria-label="駅" value={r.station} onChange={(e) => update(i, { station: e.target.value })} placeholder="駅" />
            <input className="input" aria-label="徒歩分" inputMode="numeric" value={r.walkMin ?? ""} onChange={(e) => update(i, { walkMin: e.target.value === "" ? null : Number(e.target.value) })} placeholder="徒歩分" />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setRows(rows.filter((_, j) => j !== i)); markDirty(); }}>削除</button>
          </div>
        ))}
      </div>
      <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={() => { setRows([...rows, { line: "", station: "", walkMin: null }]); markDirty(); }}>
        ＋ 交通を追加
      </button>
    </div>
  );
}
