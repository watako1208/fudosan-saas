"use client";
import { useState } from "react";
import { useFormCtx } from "@/components/EditForm";
import { searchParties } from "@/lib/server/actions/parties";

export interface PickItem {
  id: string;
  label: string;
  sub?: string;
}

/** 検索して1件を選ぶ小部品（フォーム外でも利用可） */
export function SearchSelect({
  search,
  onPick,
  placeholder = "名前・読み・電話番号・番号で検索",
  autoFocus,
}: {
  search: (q: string) => Promise<{ ok: true; data: PickItem[] } | { ok: false; error: string }>;
  onPick: (it: PickItem) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<PickItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    if (!q.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await search(q.trim());
      if (r.ok) setItems(r.data);
      else setErr(r.error);
    } catch {
      setErr("検索に失敗しました。再試行してください");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <input
          className="input"
          value={q}
          autoFocus={autoFocus}
          placeholder={placeholder}
          aria-label="検索語"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              go();
            }
          }}
        />
        <button type="button" className="btn btn-secondary" onClick={go} disabled={busy}>{busy ? "検索中…" : "検索"}</button>
      </div>
      {err && <p className="text-sm text-danger" role="alert">{err}</p>}
      {items && (
        <ul className="max-h-64 overflow-y-auto rounded-md border border-line bg-surface">
          {items.length === 0 && <li className="px-3 py-2 text-sm text-muted">該当する候補はありません</li>}
          {items.map((it) => (
            <li key={it.id}>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left hover:bg-primary-soft"
                onClick={() => {
                  onPick(it);
                  setItems(null);
                  setQ("");
                }}
              >
                <span className="font-medium">{it.label}</span>
                {it.sub && <span className="ml-2 text-xs text-muted">{it.sub}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const partySearch = (type?: "person" | "corporation") => (q: string) => searchParties({ q, type });

/** 顧客（人・法人）を1件選ぶ。値は hidden input（name）に顧客IDで入る */
export function PartyPicker({
  name,
  label,
  initial,
  type,
  required,
  help,
  className = "sm:col-span-2",
}: {
  name: string;
  label: string;
  initial?: PickItem | null;
  type?: "person" | "corporation";
  required?: boolean;
  help?: string;
  className?: string;
}) {
  const { errors, markDirty } = useFormCtx();
  const [sel, setSel] = useState<PickItem | null>(initial ?? null);
  return (
    <div className={className}>
      <span className="label">
        {label}
        {required && <span className="ml-1 text-xs text-danger">必須</span>}
      </span>
      <input type="hidden" name={name} value={sel?.id ?? ""} />
      {sel ? (
        <div className="flex min-h-10 flex-wrap items-center gap-2 rounded-md border border-line px-3 py-1.5">
          <span className="font-medium">{sel.label}</span>
          {sel.sub && <span className="text-xs text-muted">{sel.sub}</span>}
          <button type="button" className="btn btn-ghost btn-sm ml-auto" onClick={() => { setSel(null); markDirty(); }}>選び直す</button>
        </div>
      ) : (
        <SearchSelect search={partySearch(type)} onPick={(it) => { setSel(it); markDirty(); }} />
      )}
      {help && !errors[name] && <p className="help">{help}</p>}
      {errors[name] && <p className="field-error">{errors[name]}</p>}
    </div>
  );
}

/** 顧客を複数選ぶ（同居人など）。値は hidden input に ID の JSON 配列で入る */
export function PartyMultiPicker({ name, label, initial = [], help }: { name: string; label: string; initial?: PickItem[]; help?: string }) {
  const { errors, markDirty } = useFormCtx();
  const [list, setList] = useState<PickItem[]>(initial);
  return (
    <div className="sm:col-span-2 lg:col-span-3">
      <span className="label">{label}</span>
      <input type="hidden" name={name} value={JSON.stringify(list.map((x) => x.id))} />
      {list.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2">
          {list.map((x) => (
            <li key={x.id} className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-sm">
              {x.label}
              <button type="button" className="text-danger" aria-label={`${x.label}を外す`} onClick={() => { setList(list.filter((y) => y.id !== x.id)); markDirty(); }}>×</button>
            </li>
          ))}
        </ul>
      )}
      <SearchSelect search={partySearch("person")} onPick={(it) => { if (!list.some((x) => x.id === it.id)) setList([...list, it]); markDirty(); }} />
      {help && <p className="help">{help}</p>}
      {errors[name] && <p className="field-error">{errors[name]}</p>}
    </div>
  );
}
