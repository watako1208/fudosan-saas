"use client";
import { useState } from "react";
import { useFormCtx } from "@/components/EditForm";
import { searchPartiesForBilling } from "@/lib/server/actions/billing";

/** 請求先・オーナーの選択。候補（契約当事者など）から選ぶか、名称で検索する */
export function PartyPicker({
  name,
  label,
  options: initialOptions,
  defaultValue,
  required,
  help,
}: {
  name: string;
  label: string;
  options: { value: string; label: string }[];
  defaultValue?: string | null;
  required?: boolean;
  help?: string;
}) {
  const { errors, markDirty } = useFormCtx();
  const [options, setOptions] = useState(initialOptions);
  const [value, setValue] = useState(defaultValue ?? "");
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const search = async () => {
    if (!q.trim()) return;
    setBusy(true);
    setMsg(null);
    const r = await searchPartiesForBilling({ q });
    setBusy(false);
    if (!r.ok) return setMsg(r.error);
    if (!r.data.length) return setMsg("該当する顧客が見つかりません");
    const known = new Set(options.map((o) => o.value));
    setOptions([...options, ...r.data.filter((o) => !known.has(o.value))]);
    setValue(r.data[0].value);
    markDirty();
    setMsg(`${r.data.length}件見つかりました。一覧から選択してください`);
  };
  return (
    <div className="sm:col-span-2">
      <label className="label" htmlFor={name}>
        {label}
        {required && <span className="ml-1 text-xs text-danger">必須</span>}
      </label>
      <select
        id={name}
        name={name}
        className="input"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          markDirty();
        }}
        aria-invalid={!!errors[name]}
      >
        <option value="">選択してください</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <div className="mt-2 flex gap-2">
        <input
          className="input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              search();
            }
          }}
          placeholder="他の顧客を名称・読み・番号で検索"
          aria-label={`${label}を検索`}
        />
        <button type="button" className="btn btn-secondary" onClick={search} disabled={busy}>{busy ? "検索中…" : "検索"}</button>
      </div>
      {help && !errors[name] && <p className="help">{help}</p>}
      {msg && <p className="help">{msg}</p>}
      {errors[name] && <p className="field-error">{errors[name]}</p>}
    </div>
  );
}
