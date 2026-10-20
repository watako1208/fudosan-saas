"use client";
import { useEffect, useState } from "react";
import { pickerSearch, unitsOfProperty } from "@/lib/server/actions/support";
import { useFormCtx } from "@/components/EditForm";

type Opt = { value: string; label: string; sub?: string };

/** 顧客・業者・物件の検索選択（選択値は hidden input で送信） */
export function EntityPicker({
  kind,
  name,
  label,
  initialLabel,
  required,
  help,
  onChange,
}: {
  kind: "party" | "property" | "vendor";
  name: string;
  label: string;
  initialLabel?: string | null;
  required?: boolean;
  help?: string;
  onChange?: (value: string) => void;
}) {
  const { initial, errors, markDirty } = useFormCtx();
  const [value, setValue] = useState<string>(String(initial[name] ?? ""));
  const [selLabel, setSelLabel] = useState<string>(initialLabel ?? "");
  const [q, setQ] = useState("");
  const [opts, setOpts] = useState<Opt[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const search = async () => {
    if (!q.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await pickerSearch(kind, q);
      setOpts(r);
      if (!r.length) setErr("該当するデータがありません");
    } catch {
      setErr("検索できませんでした（閲覧権限がないか、通信に失敗しました）");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <label className="label">
        {label}
        {required && <span className="ml-1 text-xs text-danger">必須</span>}
      </label>
      <input type="hidden" name={name} value={value} />
      {value ? (
        <div className="flex min-h-10 items-center gap-2 rounded-md border border-line bg-bg px-3">
          <span className="flex-1 break-words">{selLabel || "選択済み"}</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setValue("");
              setSelLabel("");
              onChange?.("");
              markDirty();
            }}
          >
            解除
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <input
            className="input"
            value={q}
            placeholder="名前・番号で検索"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void search();
              }
            }}
            aria-label={`${label}を検索`}
          />
          <button type="button" className="btn btn-secondary" onClick={search} disabled={busy}>
            {busy ? "検索中…" : "検索"}
          </button>
        </div>
      )}
      {!value && opts.length > 0 && (
        <ul className="mt-1 max-h-56 overflow-y-auto rounded-md border border-line bg-surface">
          {opts.map((o) => (
            <li key={o.value}>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-primary-soft"
                onClick={() => {
                  setValue(o.value);
                  setSelLabel(o.label);
                  setOpts([]);
                  onChange?.(o.value);
                  markDirty();
                }}
              >
                {o.label}
                {o.sub && <span className="ml-2 text-xs text-muted">{o.sub}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {err && <p className="help">{err}</p>}
      {help && <p className="help">{help}</p>}
      {errors[name] && <p className="field-error">{errors[name]}</p>}
    </div>
  );
}

/** 物件＋部屋の選択 */
export function PropertyUnitPicker({ propertyLabel, unitId }: { propertyLabel?: string | null; unitId?: string | null }) {
  const { initial, errors } = useFormCtx();
  const [propertyId, setPropertyId] = useState<string>(String(initial.propertyId ?? ""));
  const [units, setUnits] = useState<Opt[]>([]);
  const [unit, setUnit] = useState<string>(unitId ?? String(initial.unitId ?? ""));

  useEffect(() => {
    let alive = true;
    if (!propertyId) {
      setUnits([]);
      return;
    }
    unitsOfProperty(propertyId)
      .then((u) => alive && setUnits(u))
      .catch(() => alive && setUnits([]));
    return () => {
      alive = false;
    };
  }, [propertyId]);

  return (
    <>
      <EntityPicker
        kind="property"
        name="propertyId"
        label="物件"
        initialLabel={propertyLabel}
        onChange={(v) => {
          setPropertyId(v);
          setUnit("");
        }}
      />
      <div>
        <label className="label" htmlFor="unitId">部屋・区画</label>
        <select id="unitId" name="unitId" className="input" value={unit} onChange={(e) => setUnit(e.target.value)} disabled={!propertyId}>
          <option value="">{propertyId ? "（物件全体・共用部）" : "先に物件を選択してください"}</option>
          {units.map((u) => (
            <option key={u.value} value={u.value}>{u.label}</option>
          ))}
        </select>
        {errors.unitId && <p className="field-error">{errors.unitId}</p>}
      </div>
    </>
  );
}
