"use client";
import { useState } from "react";
import { useFormCtx } from "@/components/EditForm";
import { searchUnits, searchProperties } from "@/lib/server/actions/contracts";
import { SearchPicker } from "./SearchPicker";

/** 部屋・区画の選択（賃貸） */
export function UnitField({ name = "unitId", initialLabel, disabled }: { name?: string; initialLabel: string | null; disabled?: boolean }) {
  const { initial, errors, markDirty } = useFormCtx();
  const [value, setValue] = useState<{ id: string; label: string } | null>(() =>
    initial[name] ? { id: String(initial[name]), label: initialLabel ?? "（選択済み）" } : null,
  );
  return (
    <div className="sm:col-span-2 lg:col-span-3">
      <span className="label">対象の部屋・区画</span>
      <input type="hidden" name={name} value={value?.id ?? ""} />
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {value ? <span className="font-semibold">{value.label}</span> : <span className="text-muted">未選択</span>}
        {value && !disabled && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setValue(null); markDirty(); }}>選択を外す</button>
        )}
      </div>
      {disabled ? (
        <p className="help">条件変更の版では部屋を変更できません。</p>
      ) : (
        <SearchPicker search={searchUnits} placeholder="物件名・部屋番号・物件番号で検索" onPick={(it) => { setValue({ id: it.id, label: it.label }); markDirty(); }} />
      )}
      {errors[name] && <p className="field-error">{errors[name]}</p>}
    </div>
  );
}

/** 売買の対象物件（複数の土地・建物） */
export function PropertiesField({ name = "propertyIds", initialLabels }: { name?: string; initialLabels: Record<string, string> }) {
  const { initial, errors, markDirty } = useFormCtx();
  const [rows, setRows] = useState<{ id: string; label: string }[]>(() =>
    ((initial[name] as string[] | undefined) ?? []).map((id) => ({ id, label: initialLabels[id] ?? "（不明な物件）" })),
  );
  return (
    <div className="sm:col-span-2 lg:col-span-3">
      <span className="label">対象の土地・建物（複数可）</span>
      <input type="hidden" name={name} value={JSON.stringify(rows.map((r) => r.id))} />
      {rows.length === 0 ? (
        <p className="mb-2 text-sm text-muted">未選択</p>
      ) : (
        <ul className="mb-2 divide-y divide-line rounded-md border border-line">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="font-medium">{r.label}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setRows(rows.filter((x) => x.id !== r.id)); markDirty(); }}>外す</button>
            </li>
          ))}
        </ul>
      )}
      <SearchPicker
        search={searchProperties}
        placeholder="物件名・住所・物件番号で検索して追加"
        buttonLabel="検索"
        onPick={(it) => {
          if (rows.some((r) => r.id === it.id)) return;
          setRows([...rows, { id: it.id, label: it.label }]);
          markDirty();
        }}
      />
      {errors[name] && <p className="field-error">{errors[name]}</p>}
    </div>
  );
}
