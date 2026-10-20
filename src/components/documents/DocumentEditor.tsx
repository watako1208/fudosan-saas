"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DocBlock } from "@/lib/types";
import type { ActionResult } from "@/lib/server/action";
import type { XBlock } from "@/lib/server/docgen/engine";
import { BlockEditor, ImageOption } from "./BlockEditor";
import { DocBlocksView, DOC_CSS } from "./DocBlocksView";

type SaveState = "clean" | "dirty" | "saving" | "saved" | "failed";

/** 書類本文の編集（下書きの版のみ）。保存状態を文字で表示し、未保存の移動を確認する */
export function DocumentEditor({
  documentId,
  versionId,
  version,
  title: initialTitle,
  blocks: initialBlocks,
  autoRendered,
  images,
  action,
}: {
  documentId: string;
  versionId: string;
  version: number;
  title: string;
  blocks: XBlock[];
  autoRendered: Record<string, DocBlock>;
  images: ImageOption[];
  action: (v: Record<string, unknown>) => Promise<ActionResult<unknown>>;
}) {
  const router = useRouter();
  const [blocks, setBlocks] = useState<XBlock[]>(initialBlocks);
  const [title, setTitle] = useState(initialTitle);
  const [state, setState] = useState<SaveState>("clean");
  const [errors, setErrors] = useState<string[]>([]);
  const [conflict, setConflict] = useState(false);
  const [preview, setPreview] = useState(false);
  const rid = useRef(crypto.randomUUID());
  const dirty = state === "dirty" || state === "failed";

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    const onClick = (e: MouseEvent) => {
      if (!dirty) return;
      const a = (e.target as HTMLElement).closest("a");
      if (a && a.href && !a.target && !window.confirm("保存していない変更があります。移動すると変更は失われます。移動しますか？")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", h);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", h);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  const change = (b: XBlock[]) => {
    setBlocks(b);
    setState("dirty");
  };

  const save = async () => {
    setState("saving");
    setErrors([]);
    try {
      const r = await action({ id: documentId, versionId, title, blocks: JSON.stringify(blocks), _version: version, _requestId: rid.current });
      if (r.ok) {
        rid.current = crypto.randomUUID();
        setState("saved");
        router.refresh();
      } else {
        setState("failed");
        if (r.code === "conflict") setConflict(true);
        setErrors(r.errors?.length ? r.errors : [r.error]);
      }
    } catch {
      setState("failed");
      setErrors(["通信に失敗しました。編集内容は保持されています。再試行してください。"]);
    }
  };

  const label: Record<SaveState, [string, string]> = {
    clean: ["変更なし", "text-muted"],
    dirty: ["未保存", "text-warn"],
    saving: ["保存中…", "text-primary"],
    saved: ["保存済み", "text-ok"],
    failed: ["保存失敗", "text-danger"],
  };

  return (
    <div className="pb-24">
      <style>{DOC_CSS}</style>
      {errors.length > 0 && (
        <div className="mb-3 rounded-md border border-danger/30 bg-danger-soft p-3 text-sm text-danger" role="alert">
          <ul className="list-disc pl-5">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
          {conflict && (
            <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={() => { setState("clean"); setTimeout(() => location.reload(), 0); }}>
              最新情報を読み直す（この画面の編集は破棄されます）
            </button>
          )}
        </div>
      )}
      <label className="mb-3 block">
        <span className="label">書類名</span>
        <input className="input" value={title} onChange={(e) => { setTitle(e.target.value); setState("dirty"); }} maxLength={200} />
      </label>
      <div className="mb-3 flex gap-2">
        <button type="button" className={`btn btn-sm ${!preview ? "btn-primary" : "btn-secondary"}`} onClick={() => setPreview(false)}>編集</button>
        <button type="button" className={`btn btn-sm ${preview ? "btn-primary" : "btn-secondary"}`} onClick={() => setPreview(true)}>プレビュー</button>
      </div>
      {preview ? (
        <div className="overflow-x-auto bg-bg p-2">
          <div className="doc-sheet"><DocBlocksView blocks={blocks} /></div>
        </div>
      ) : (
        <BlockEditor blocks={blocks} onChange={change} images={images} autoRendered={autoRendered} />
      )}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur lg:left-64">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <span className={`text-sm font-semibold ${label[state][1]}`} aria-live="polite">{label[state][0]}</span>
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary" disabled={!dirty} onClick={() => { if (window.confirm("編集内容を破棄して保存済みの状態に戻しますか？")) { setBlocks(initialBlocks); setTitle(initialTitle); setState("clean"); } }}>キャンセル</button>
            <button type="button" className="btn btn-primary" disabled={state === "saving"} onClick={save}>{state === "saving" ? "保存中…" : "保存"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
