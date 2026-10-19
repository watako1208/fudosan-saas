"use client";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { StateMessage } from "./ui";
import { toCsv } from "@/lib/domain/csv-export";

export interface Column {
  key: string;
  label: string;
  sortable?: boolean;
  align?: "left" | "right";
  /** 初期表示で隠す */
  hidden?: boolean;
  /** スマホのカード表示で見出しに使う */
  primary?: boolean;
  /** 個人情報を含む列（CSV出力時に確認） */
  personal?: boolean;
  width?: number;
}

export interface Row {
  id: string;
  href?: string;
  cells: Record<string, ReactNode>;
  csv?: Record<string, string | number | null>;
}

export interface BulkAction {
  label: string;
  run: (ids: string[]) => Promise<{ ok: boolean; error?: string }>;
  confirm?: string;
}

/**
 * 共通一覧。並べ替え・列の表示切替・列幅変更・行選択・CSV出力・ページ切替を共通化する。
 * 行全体のクリックで詳細へ移動し、チェックボックスや操作ボタンでは移動しない。
 */
export function DataTable({
  tableId,
  columns,
  rows,
  total,
  page,
  pageSize,
  filtered,
  loadError,
  bulkActions = [],
  csvName,
  emptyAction,
}: {
  tableId: string;
  columns: Column[];
  rows: Row[];
  total: number;
  page: number;
  pageSize: number;
  filtered?: boolean;
  loadError?: string | null;
  bulkActions?: BulkAction[];
  csvName?: string;
  emptyAction?: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(columns.filter((c) => c.hidden).map((c) => c.key)));
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [colMenu, setColMenu] = useState(false);
  const [csvDialog, setCsvDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`dt:${tableId}`);
      if (raw) {
        const v = JSON.parse(raw);
        if (Array.isArray(v.hidden)) setHidden(new Set(v.hidden));
        if (v.widths) setWidths(v.widths);
      }
    } catch {
      /* 保存できない環境では既定表示 */
    }
  }, [tableId]);

  const persist = (h: Set<string>, w: Record<string, number>) => {
    try {
      localStorage.setItem(`dt:${tableId}`, JSON.stringify({ hidden: [...h], widths: w }));
    } catch {
      /* noop */
    }
  };

  const visible = columns.filter((c) => !hidden.has(c.key));
  const sort = sp.get("sort") ?? "";
  const dir = sp.get("dir") ?? "desc";
  const pages = Math.max(1, Math.ceil(total / pageSize));

  const setParam = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    router.push(`${pathname}?${p.toString()}`);
  };

  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.id)));
  const toggle = (id: string) => {
    const s = new Set(selected);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setSelected(s);
  };

  const csvRows = useMemo(() => {
    const target = selected.size ? rows.filter((r) => selected.has(r.id)) : rows;
    return target;
  }, [rows, selected]);
  const personalCols = visible.filter((c) => c.personal);

  const downloadCsv = () => {
    const cols = visible;
    const text = toCsv(
      cols.map((c) => c.label),
      csvRows.map((r) => cols.map((c) => r.csv?.[c.key] ?? (typeof r.cells[c.key] === "string" || typeof r.cells[c.key] === "number" ? (r.cells[c.key] as string) : ""))),
    );
    const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${csvName ?? tableId}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    setCsvDialog(false);
  };

  const startResize = (key: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const th = (e.target as HTMLElement).parentElement!;
    const startX = e.clientX;
    const startW = th.getBoundingClientRect().width;
    const move = (ev: MouseEvent) => setWidths((w) => ({ ...w, [key]: Math.max(60, startW + ev.clientX - startX) }));
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      setWidths((w) => {
        persist(hidden, w);
        return w;
      });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  if (loadError) return <div className="card"><StateMessage kind="error" message={loadError} /></div>;

  return (
    <div className="card overflow-hidden">
      {/* 件数・一括操作 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
        <div className="text-sm text-muted">
          全 <span className="font-semibold text-ink">{total.toLocaleString()}</span> 件
          {selected.size > 0 && <span className="ml-2">（{selected.size}件選択中）</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {selected.size > 0 &&
            bulkActions.map((b) => (
              <button
                key={b.label}
                className="btn btn-secondary btn-sm"
                disabled={busy}
                onClick={async () => {
                  if (b.confirm && !window.confirm(b.confirm)) return;
                  setBusy(true);
                  setMsg(null);
                  const r = await b.run([...selected]);
                  setBusy(false);
                  if (!r.ok) setMsg(r.error ?? "処理に失敗しました");
                  else {
                    setSelected(new Set());
                    router.refresh();
                  }
                }}
              >
                {b.label}
              </button>
            ))}
          <button className="btn btn-secondary btn-sm" onClick={() => setCsvDialog(true)} disabled={rows.length === 0}>
            CSV出力
          </button>
          <div className="relative">
            <button className="btn btn-secondary btn-sm" onClick={() => setColMenu((v) => !v)} aria-expanded={colMenu}>
              表示列
            </button>
            {colMenu && (
              <div className="absolute right-0 z-30 mt-1 w-56 rounded-md border border-line bg-surface p-2 shadow-lg">
                {columns.map((c) => (
                  <label key={c.key} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-bg">
                    <input
                      type="checkbox"
                      checked={!hidden.has(c.key)}
                      onChange={() => {
                        const h = new Set(hidden);
                        if (h.has(c.key)) h.delete(c.key);
                        else h.add(c.key);
                        setHidden(h);
                        persist(h, widths);
                      }}
                    />
                    {c.label}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      {msg && <div className="border-b border-line bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{msg}</div>}

      {rows.length === 0 ? (
        <StateMessage kind={filtered ? "no_results" : "empty"} action={!filtered ? emptyAction : undefined} />
      ) : (
        <>
          {/* PC: 表 */}
          <div className="hidden overflow-x-auto md:block">
            <table className="table" style={{ tableLayout: Object.keys(widths).length ? "fixed" : "auto" }}>
              <thead>
                <tr>
                  <th className="w-10">
                    <input type="checkbox" aria-label="すべて選択" checked={allChecked} onChange={toggleAll} />
                  </th>
                  {visible.map((c) => (
                    <th key={c.key} className="relative" style={{ width: widths[c.key] ?? c.width }}>
                      {c.sortable ? (
                        <button
                          className="inline-flex items-center gap-1 hover:text-ink"
                          onClick={() => setParam({ sort: c.key, dir: sort === c.key && dir === "asc" ? "desc" : "asc", page: null })}
                        >
                          {c.label}
                          <span aria-hidden>{sort === c.key ? (dir === "asc" ? "▲" : "▼") : "↕"}</span>
                          <span className="sr-only">{sort === c.key ? (dir === "asc" ? "昇順" : "降順") : "並べ替え"}</span>
                        </button>
                      ) : (
                        c.label
                      )}
                      <span
                        className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-primary/30"
                        onMouseDown={(e) => startResize(c.key, e)}
                        aria-hidden
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={r.href ? "row-link" : ""} onClick={() => r.href && router.push(r.href)}>
                    <td onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" aria-label="選択" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                    </td>
                    {visible.map((c) => (
                      <td key={c.key} className={c.align === "right" ? "num" : "break-words"}>
                        {r.cells[c.key] ?? <span className="text-muted">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* スマートフォン: 要点をまとめたカード */}
          <ul className="divide-y divide-line md:hidden">
            {rows.map((r) => {
              const prim = visible.find((c) => c.primary) ?? visible[0];
              return (
                <li key={r.id} className={`flex gap-3 px-3 py-3 ${r.href ? "active:bg-primary-soft" : ""}`} onClick={() => r.href && router.push(r.href)}>
                  <div onClick={(e) => e.stopPropagation()} className="pt-1">
                    <input type="checkbox" aria-label="選択" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold break-words">{r.cells[prim.key]}</div>
                    <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
                      {visible
                        .filter((c) => c.key !== prim.key)
                        .slice(0, 5)
                        .map((c) => (
                          <div key={c.key} className="contents">
                            <dt className="text-muted">{c.label}</dt>
                            <dd className="break-words">{r.cells[c.key] ?? "—"}</dd>
                          </div>
                        ))}
                    </dl>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {/* ページ切替 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2 text-sm">
        <label className="flex items-center gap-2">
          表示件数
          <select className="input !min-h-8 !w-20 !py-0" value={pageSize} onChange={(e) => setParam({ size: e.target.value, page: null })}>
            {[25, 50, 100].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-2">
          <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setParam({ page: String(page - 1) })}>前へ</button>
          <span>{page} / {pages}</span>
          <button className="btn btn-secondary btn-sm" disabled={page >= pages} onClick={() => setParam({ page: String(page + 1) })}>次へ</button>
        </div>
      </div>

      {csvDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal>
          <div className="w-full max-w-md rounded-lg bg-surface p-5 shadow-xl">
            <h2>CSV出力の確認</h2>
            <ul className="mt-3 space-y-1 text-sm">
              <li>出力件数: <b>{csvRows.length}件</b>（{selected.size ? "選択した行" : "表示中のページ"}）</li>
              <li>出力列: {visible.map((c) => c.label).join("、")}</li>
              {personalCols.length > 0 && (
                <li className="rounded bg-warn-soft p-2 text-warn">
                  個人情報を含む列があります: {personalCols.map((c) => c.label).join("、")}。取扱いに注意してください。
                </li>
              )}
            </ul>
            <p className="help">表計算ソフトで数式として解釈される値は無害化して出力します。</p>
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn btn-secondary" onClick={() => setCsvDialog(false)}>キャンセル</button>
              <button className="btn btn-primary" onClick={downloadCsv}>出力する</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
