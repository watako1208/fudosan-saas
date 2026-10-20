"use client";
import { useState } from "react";
import { useFormCtx } from "@/components/EditForm";
import { SearchSelect } from "@/components/parties/PartyPicker";
import { searchListingCandidates } from "@/lib/server/actions/proposals";

export interface TargetItem {
  propertyId: string;
  unitId: string | null;
  label: string;
  sub?: string;
}

export async function searchTargets(q: string) {
  const r = await searchListingCandidates({ q });
  if (!r.ok) return r;
  return { ok: true as const, data: r.data.map((x) => ({ id: `${x.propertyId}:${x.unitId ?? ""}`, label: x.label, sub: x.sub })) };
}

export function splitKey(id: string): { propertyId: string; unitId: string | null } {
  const [propertyId, unitId] = id.split(":");
  return { propertyId, unitId: unitId || null };
}

/** 案件の対象物件（物件全体または部屋・区画）を複数選ぶ。案件と物件は一対一に限定しない */
export function TargetsPicker({ name = "targets", label = "対象物件", initial = [] }: { name?: string; label?: string; initial?: TargetItem[] }) {
  const { errors, markDirty } = useFormCtx();
  const [list, setList] = useState<TargetItem[]>(initial);
  return (
    <div className="sm:col-span-2 lg:col-span-3">
      <span className="label">{label}</span>
      <input type="hidden" name={name} value={JSON.stringify(list.map(({ propertyId, unitId }) => ({ propertyId, unitId })))} />
      {list.length > 0 && (
        <ul className="mb-2 space-y-1">
          {list.map((t) => (
            <li key={`${t.propertyId}:${t.unitId ?? ""}`} className="flex items-center gap-2 rounded-md border border-line px-3 py-1.5 text-sm">
              <span className="font-medium">{t.label}</span>
              {t.sub && <span className="text-xs text-muted">{t.sub}</span>}
              <button
                type="button"
                className="btn btn-ghost btn-sm ml-auto"
                onClick={() => {
                  setList(list.filter((x) => !(x.propertyId === t.propertyId && x.unitId === t.unitId)));
                  markDirty();
                }}
              >
                外す
              </button>
            </li>
          ))}
        </ul>
      )}
      <SearchSelect
        placeholder="物件名・部屋番号・物件番号・住所で検索"
        search={searchTargets}
        onPick={(it) => {
          const k = splitKey(it.id);
          if (!list.some((x) => x.propertyId === k.propertyId && x.unitId === k.unitId)) setList([...list, { ...k, label: it.label, sub: it.sub }]);
          markDirty();
        }}
      />
      {errors[name] && <p className="field-error">{errors[name]}</p>}
    </div>
  );
}
