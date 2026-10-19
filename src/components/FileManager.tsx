"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { updateAttachments, archiveAttachment } from "@/lib/server/actions/properties";
import { VISIBILITY, opts } from "@/lib/labels";
import type { Attachment } from "@/lib/types";

type Item = Pick<Attachment, "id" | "fileName" | "contentType" | "category" | "description" | "visibility" | "takenAt" | "sort" | "size" | "sensitive">;

/**
 * 写真・資料管理（S05）: 複数登録、並べ替え、一括分類、説明の一括編集。
 * 表示順を変えても原本ファイルは加工しない。スマートフォンのカメラからも登録できる。
 */
export function FileManager({
  entity,
  entityId,
  items: initialItems,
  canWrite,
  categories = ["外観", "室内", "間取り", "設備", "周辺", "図面", "契約書", "重要事項説明", "見積書", "工事写真（前）", "工事写真（後）", "その他"],
  allowSensitive = false,
  defaultVisibility = "internal",
}: {
  entity: string;
  entityId: string;
  items: Item[];
  canWrite: boolean;
  categories?: string[];
  allowSensitive?: boolean;
  defaultVisibility?: Attachment["visibility"];
}) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msgs, setMsgs] = useState<{ ok: boolean; text: string }[]>([]);
  const [dirty, setDirty] = useState(false);
  const [category, setCategory] = useState(categories[0]);
  const [sensitive, setSensitive] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragId = useRef<string | null>(null);

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setMsgs([]);
    setProgress(`${files.length}件を登録中…`);
    const fd = new FormData();
    fd.set("entity", entity);
    fd.set("entityId", entityId);
    fd.set("category", category);
    fd.set("visibility", defaultVisibility);
    fd.set("sensitive", String(sensitive));
    for (const f of Array.from(files)) fd.append("files", f);
    try {
      const r = await fetch("/api/upload", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) setMsgs([{ ok: false, text: j.error ?? "登録に失敗しました" }]);
      else {
        const res = j.results as { ok: boolean; error?: string }[];
        const okCount = res.filter((x) => x.ok).length;
        setMsgs([
          ...(okCount ? [{ ok: true, text: `${okCount}件を登録しました` }] : []),
          ...res.filter((x) => !x.ok).map((x) => ({ ok: false, text: x.error ?? "登録に失敗しました" })),
        ]);
        router.refresh();
      }
    } catch {
      setMsgs([{ ok: false, text: "通信に失敗しました。再試行してください" }]);
    } finally {
      setBusy(false);
      setProgress(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const save = async () => {
    setBusy(true);
    const r = await updateAttachments({
      entity,
      entityId,
      items: items.map((it, i) => ({ id: it.id, sort: i + 1, category: it.category, description: it.description, visibility: it.visibility, takenAt: it.takenAt })),
    });
    setBusy(false);
    if (r.ok) {
      setDirty(false);
      setMsgs([{ ok: true, text: "保存しました" }]);
      router.refresh();
    } else setMsgs([{ ok: false, text: r.error }]);
  };

  const patchSelected = (patch: Partial<Item>) => {
    setItems(items.map((it) => (selected.has(it.id) ? { ...it, ...patch } : it)));
    setDirty(true);
  };
  const move = (id: string, delta: number) => {
    const i = items.findIndex((x) => x.id === id);
    const j = i + delta;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    setItems(next);
    setDirty(true);
  };

  return (
    <div className="space-y-3">
      {canWrite && (
        <div className="card card-pad flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="label">登録時の分類</span>
            <select className="input !w-auto" value={category} onChange={(e) => setCategory(e.target.value)}>
              {categories.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          {allowSensitive && (
            <label className="flex min-h-10 items-center gap-2 text-sm">
              <input type="checkbox" checked={sensitive} onChange={(e) => setSensitive(e.target.checked)} />
              本人確認資料など（閲覧権限を限定）
            </label>
          )}
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx,.csv,image/*"
            className="hidden"
            onChange={(e) => upload(e.target.files)}
          />
          <button className="btn btn-primary" disabled={busy} onClick={() => fileRef.current?.click()}>
            ＋ ファイルを選択（複数可・カメラ可）
          </button>
          <p className="help w-full">PDF・JPEG・PNG・WebP・DOCX・XLSX・CSV。中身を確認し、形式が一致しないファイルは隔離します。</p>
        </div>
      )}
      {progress && <p className="text-sm text-primary" aria-live="polite">{progress}</p>}
      {msgs.map((m, i) => (
        <p key={i} className={`text-sm ${m.ok ? "text-ok" : "text-danger"}`} role={m.ok ? "status" : "alert"}>{m.text}</p>
      ))}

      {items.length === 0 ? (
        <p className="card px-4 py-8 text-center text-muted">写真・資料はまだ登録されていません</p>
      ) : (
        <>
          {canWrite && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>{selected.size}件選択</span>
              <select className="input !w-auto" disabled={!selected.size} onChange={(e) => e.target.value && patchSelected({ category: e.target.value })} value="">
                <option value="">分類を一括変更</option>
                {categories.map((c) => <option key={c}>{c}</option>)}
              </select>
              <select className="input !w-auto" disabled={!selected.size} onChange={(e) => e.target.value && patchSelected({ visibility: e.target.value as Item["visibility"] })} value="">
                <option value="">公開範囲を一括変更</option>
                {opts(VISIBILITY).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <button
                className="btn btn-secondary btn-sm"
                disabled={!selected.size}
                onClick={() => {
                  const d = window.prompt("選択した資料の説明を一括で設定");
                  if (d !== null) patchSelected({ description: d });
                }}
              >
                説明を一括編集
              </button>
              <span className={`ml-auto font-semibold ${dirty ? "text-warn" : "text-muted"}`}>{dirty ? "未保存" : "変更なし"}</span>
              <button className="btn btn-primary btn-sm" disabled={!dirty || busy} onClick={save}>並び順・分類を保存</button>
            </div>
          )}
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((it, idx) => (
              <li
                key={it.id}
                className={`card overflow-hidden ${selected.has(it.id) ? "ring-2 ring-primary" : ""}`}
                draggable={canWrite}
                onDragStart={() => (dragId.current = it.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  const from = items.findIndex((x) => x.id === dragId.current);
                  if (from < 0 || from === idx) return;
                  const next = [...items];
                  const [m] = next.splice(from, 1);
                  next.splice(idx, 0, m);
                  setItems(next);
                  setDirty(true);
                }}
              >
                <a href={`/api/files/${it.id}`} target="_blank" rel="noreferrer" className="block aspect-[4/3] bg-bg">
                  {it.contentType.startsWith("image/") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/files/${it.id}`} alt={it.description ?? it.fileName} className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <span className="flex h-full items-center justify-center text-sm text-muted">{it.fileName.split(".").pop()?.toUpperCase()} ファイルを開く</span>
                  )}
                </a>
                <div className="space-y-2 p-3 text-sm">
                  <div className="flex items-center gap-2">
                    {canWrite && (
                      <input
                        type="checkbox"
                        aria-label="選択"
                        checked={selected.has(it.id)}
                        onChange={() => {
                          const s = new Set(selected);
                          if (s.has(it.id)) s.delete(it.id);
                          else s.add(it.id);
                          setSelected(s);
                        }}
                      />
                    )}
                    <span className="truncate font-medium" title={it.fileName}>{idx + 1}. {it.fileName}</span>
                    {it.sensitive && <span className="rounded bg-warn-soft px-1 text-xs text-warn">閲覧制限</span>}
                  </div>
                  {canWrite ? (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <select className="input" aria-label="分類" value={it.category} onChange={(e) => { setItems(items.map((x) => (x.id === it.id ? { ...x, category: e.target.value } : x))); setDirty(true); }}>
                          {[...new Set([...categories, it.category])].map((c) => <option key={c}>{c}</option>)}
                        </select>
                        <input className="input" type="date" aria-label="撮影日" value={it.takenAt ?? ""} onChange={(e) => { setItems(items.map((x) => (x.id === it.id ? { ...x, takenAt: e.target.value || null } : x))); setDirty(true); }} />
                      </div>
                      <input className="input" aria-label="説明" placeholder="説明" value={it.description ?? ""} onChange={(e) => { setItems(items.map((x) => (x.id === it.id ? { ...x, description: e.target.value } : x))); setDirty(true); }} />
                      <select className="input" aria-label="公開範囲" disabled={it.sensitive} value={it.visibility} onChange={(e) => { setItems(items.map((x) => (x.id === it.id ? { ...x, visibility: e.target.value as Item["visibility"] } : x))); setDirty(true); }}>
                        {opts(VISIBILITY).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      <div className="flex justify-between">
                        <div className="flex gap-1">
                          <button className="btn btn-secondary btn-sm" onClick={() => move(it.id, -1)} aria-label="前へ">↑</button>
                          <button className="btn btn-secondary btn-sm" onClick={() => move(it.id, 1)} aria-label="後へ">↓</button>
                        </div>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={async () => {
                            if (!window.confirm("この資料を一覧から外しますか？（原本は保持されます）")) return;
                            const r = await archiveAttachment({ id: it.id });
                            if (r.ok) setItems(items.filter((x) => x.id !== it.id));
                            else setMsgs([{ ok: false, text: r.error }]);
                          }}
                        >
                          外す
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="text-muted">{it.category}{it.description ? ` / ${it.description}` : ""}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
