"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

/** 外部利用者の提出資料・写真の登録（/api/portal/upload）。スマートフォンのカメラからも登録できる */
export function PortalUpload({ entity, entityId, categories }: { entity: string; entityId: string; categories: string[] }) {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState(categories[0]);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [msgs, setMsgs] = useState<{ ok: boolean; text: string }[]>([]);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setMsgs([]);
    const fd = new FormData();
    fd.set("entity", entity);
    fd.set("entityId", entityId);
    fd.set("category", category);
    fd.set("description", description);
    for (const f of Array.from(files)) fd.append("files", f);
    try {
      const r = await fetch("/api/portal/upload", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) setMsgs([{ ok: false, text: j.error ?? "登録に失敗しました" }]);
      else {
        const res = j.results as { ok: boolean; error?: string }[];
        const n = res.filter((x) => x.ok).length;
        setMsgs([...(n ? [{ ok: true, text: `${n}件を提出しました` }] : []), ...res.filter((x) => !x.ok).map((x) => ({ ok: false, text: x.error ?? "登録に失敗しました" }))]);
        setDescription("");
        router.refresh();
      }
    } catch {
      setMsgs([{ ok: false, text: "通信に失敗しました。再試行してください" }]);
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label">分類</span>
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="label">説明（任意）</span>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
      </div>
      <input ref={ref} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx,.csv,image/*" className="hidden" onChange={(e) => upload(e.target.files)} />
      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => ref.current?.click()}>
        {busy ? "送信中…" : "ファイルを選んで提出"}
      </button>
      <p className="help">PDF・JPEG・PNG・WebP・DOCX・XLSX・CSV。実行形式やマクロ付きのファイルは提出できません。</p>
      {msgs.map((m, i) => (
        <p key={i} className={`text-sm ${m.ok ? "text-ok" : "text-danger"}`} role={m.ok ? undefined : "alert"}>{m.text}</p>
      ))}
    </div>
  );
}
