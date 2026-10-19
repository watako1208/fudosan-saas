"use client";
import { useEffect, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { listSavedFilters, saveFilter, deleteSavedFilter, SavedFilter } from "@/lib/server/prefs";

export interface FilterDef {
  key: string;
  label: string;
  options: { value: string; label: string }[];
}

/** 検索・絞込み。条件はURLに反映し、利用者別に保存できる */
export function FilterBar({ tableId, placeholder, filters = [] }: { tableId: string; placeholder: string; filters?: FilterDef[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [saved, setSaved] = useState<SavedFilter[]>([]);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    listSavedFilters(tableId).then(setSaved).catch(() => setSaved([]));
  }, [tableId]);

  const push = (patch: Record<string, string>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    p.delete("page");
    router.push(`${pathname}?${p.toString()}`);
  };

  const hasFilter = !!sp.get("q") || filters.some((f) => sp.get(f.key));

  return (
    <div className="mb-3 flex flex-wrap items-end gap-2">
      <form
        className="flex min-w-[240px] flex-1 gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          push({ q });
        }}
        role="search"
      >
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label="検索" />
        <button className="btn btn-secondary" type="submit">検索</button>
      </form>
      {filters.map((f) => (
        <label key={f.key} className="text-sm">
          <span className="sr-only">{f.label}</span>
          <select className="input !w-auto" value={sp.get(f.key) ?? ""} onChange={(e) => push({ [f.key]: e.target.value })}>
            <option value="">{f.label}: すべて</option>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>{f.label}: {o.label}</option>
            ))}
          </select>
        </label>
      ))}
      {hasFilter && (
        <button className="btn btn-ghost" onClick={() => { setQ(""); router.push(pathname); }}>条件をクリア</button>
      )}
      <div className="relative">
        <button className="btn btn-secondary" onClick={() => setMenu((v) => !v)} aria-expanded={menu}>保存した条件</button>
        {menu && (
          <div className="absolute right-0 z-30 mt-1 w-72 rounded-md border border-line bg-surface p-2 shadow-lg">
            {saved.length === 0 && <p className="px-2 py-1 text-sm text-muted">保存した条件はありません</p>}
            {saved.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2 rounded px-2 py-1 hover:bg-bg">
                <button className="flex-1 text-left text-sm" onClick={() => { setMenu(false); router.push(`${pathname}?${s.query}`); }}>{s.name}</button>
                <button
                  className="text-xs text-danger"
                  onClick={async () => {
                    await deleteSavedFilter(s.id);
                    setSaved(saved.filter((x) => x.id !== s.id));
                  }}
                >
                  削除
                </button>
              </div>
            ))}
            <button
              className="btn btn-ghost btn-sm mt-1 w-full"
              disabled={!hasFilter}
              onClick={async () => {
                const name = window.prompt("この絞込み条件の名前");
                if (!name) return;
                const r = await saveFilter(tableId, name, sp.toString());
                if (r.ok) setSaved([...saved, r.data]);
                else window.alert(r.error);
              }}
            >
              現在の条件を保存
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
