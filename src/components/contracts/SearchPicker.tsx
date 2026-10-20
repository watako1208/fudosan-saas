"use client";
import { useState } from "react";
import type { ActionResult } from "@/lib/server/action";

export interface PickItem {
  id: string;
  label: string;
  sub: string;
}

/** 名称・番号などで検索して1件選ぶ（当事者・部屋・物件の選択に共通） */
export function SearchPicker({
  search,
  placeholder,
  onPick,
  buttonLabel = "検索",
}: {
  search: (input: { q: string }) => Promise<ActionResult<PickItem[]>>;
  placeholder: string;
  onPick: (item: PickItem) => void;
  buttonLabel?: string;
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
      const r = await search({ q });
      if (r.ok) setItems(r.data);
      else {
        setItems(null);
        setErr(r.error);
      }
    } catch {
      setErr("検索に失敗しました。再試行してください");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex gap-2">
        <input
          className="input"
          value={q}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              go();
            }
          }}
        />
        <button type="button" className="btn btn-secondary" onClick={go} disabled={busy}>
          {busy ? "検索中…" : buttonLabel}
        </button>
      </div>
      {err && <p className="field-error" role="alert">{err}</p>}
      {items && (
        <ul className="mt-2 max-h-64 divide-y divide-line overflow-y-auto rounded-md border border-line bg-surface">
          {items.length === 0 && <li className="px-3 py-2 text-sm text-muted">条件に一致するデータはありません</li>}
          {items.map((it) => (
            <li key={it.id}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left hover:bg-primary-soft"
                onClick={() => {
                  onPick(it);
                  setItems(null);
                  setQ("");
                }}
              >
                <span className="font-medium">{it.label}</span>
                {it.sub && <span className="block text-xs text-muted">{it.sub}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
