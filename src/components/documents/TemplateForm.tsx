"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/server/action";
import type { XBlock } from "@/lib/server/docgen/engine";
import { DOC_TYPES, FIELD_LABELS, LIST_SOURCES, TEMPLATE_DEAL_TYPE } from "@/lib/labels-documents";
import { BlockEditor, ImageOption } from "./BlockEditor";
import { DocBlocksView, DOC_CSS } from "./DocBlocksView";

export interface TemplateInitial {
  id: string | null;
  name: string;
  docType: string;
  dealType: string;
  effectiveFrom: string;
  requiredFields: string[];
  changeNote: string;
  blocks: XBlock[];
  version: number | null;
  status: "draft" | "approved" | "retired" | null;
  versionNo: number | null;
}

/** テンプレート編集。承認済みの版を保存すると新しい版（下書き）になり、承認済みの版は変更されない */
export function TemplateForm({ initial, images, action, readOnly = false }: { initial: TemplateInitial; images: ImageOption[]; action: (v: Record<string, unknown>) => Promise<ActionResult<{ redirect?: string } | null>>; readOnly?: boolean }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [state, setState] = useState<"clean" | "dirty" | "saving" | "saved" | "failed">("clean");
  const [errors, setErrors] = useState<string[]>([]);
  const [fe, setFe] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState(false);
  const rid = useRef(crypto.randomUUID());
  const dirty = state === "dirty" || state === "failed";
  const upd = (patch: Partial<TemplateInitial>) => {
    setV((x) => ({ ...x, ...patch }));
    setState("dirty");
  };

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const save = async () => {
    if (initial.status && initial.status !== "draft" && !window.confirm(`承認済み（または廃止）の版は変更できないため、第${(initial.versionNo ?? 1) + 1}版の下書きとして保存します。よろしいですか？`)) return;
    setState("saving");
    setErrors([]);
    setFe({});
    try {
      const r = await action({
        id: v.id, name: v.name, docType: v.docType, dealType: v.dealType, effectiveFrom: v.effectiveFrom,
        requiredFields: v.requiredFields.join("\n"), changeNote: v.changeNote, blocks: JSON.stringify(v.blocks),
        _version: v.version, _requestId: rid.current,
      });
      if (r.ok) {
        rid.current = crypto.randomUUID();
        setState("saved");
        const to = r.data?.redirect;
        if (to) router.push(to);
        else router.refresh();
      } else {
        setState("failed");
        setErrors(r.errors?.length ? r.errors : [r.error]);
        setFe(r.fieldErrors ?? {});
      }
    } catch {
      setState("failed");
      setErrors(["通信に失敗しました。入力内容は保持されています。再試行してください。"]);
    }
  };

  const contractType = DOC_TYPES[v.docType]?.contractType;

  return (
    <div className="pb-24">
      <style>{DOC_CSS}</style>
      {errors.length > 0 && (
        <div className="mb-3 rounded-md border border-danger/30 bg-danger-soft p-3 text-sm text-danger" role="alert">
          <p className="font-semibold">{errors.length}件の項目を確認してください</p>
          <ul className="list-disc pl-5">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}
      <section className="card mb-4">
        <div className="border-b border-line px-4 py-3"><h2 className="text-base">基本情報</h2></div>
        <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <label>
            <span className="label">テンプレート名<span className="ml-1 text-xs text-danger">必須</span></span>
            <input className="input" value={v.name} disabled={readOnly} onChange={(e) => upd({ name: e.target.value })} aria-invalid={!!fe.name} />
            {fe.name && <span className="field-error">{fe.name}</span>}
          </label>
          <label>
            <span className="label">書類種別<span className="ml-1 text-xs text-danger">必須</span></span>
            <select className="input" value={v.docType} disabled={readOnly || !!initial.id} onChange={(e) => upd({ docType: e.target.value })} aria-invalid={!!fe.docType}>
              <option value="">選択してください</option>
              {Object.entries(DOC_TYPES).map(([k, d]) => <option key={k} value={k}>{d.label}{d.contractType ? "（契約関係）" : ""}</option>)}
            </select>
            {fe.docType && <span className="field-error">{fe.docType}</span>}
            {contractType && <span className="help">契約関係書類です。社内で内容を確認したうえで承認してください。承認されるまで書類は作成できません（書式未設定）。</span>}
          </label>
          <label>
            <span className="label">対象取引</span>
            <select className="input" value={v.dealType} disabled={readOnly} onChange={(e) => upd({ dealType: e.target.value })}>
              {Object.entries(TEMPLATE_DEAL_TYPE).map(([k, d]) => <option key={k} value={k}>{d.label}</option>)}
            </select>
          </label>
          <label>
            <span className="label">適用開始日<span className="ml-1 text-xs text-danger">必須</span></span>
            <input className="input" type="date" value={v.effectiveFrom} disabled={readOnly} onChange={(e) => upd({ effectiveFrom: e.target.value })} aria-invalid={!!fe.effectiveFrom} />
            {fe.effectiveFrom && <span className="field-error">{fe.effectiveFrom}</span>}
          </label>
          <label className="sm:col-span-2">
            <span className="label">必須項目（改行区切り）</span>
            <textarea className="input font-mono text-sm" rows={3} value={v.requiredFields.join("\n")} disabled={readOnly} onChange={(e) => upd({ requiredFields: e.target.value.split(/\n/) })} />
            <span className="help">値が未入力のままでは承認できない差込み項目（例: lessee.name、contract.monthlyItems）</span>
          </label>
          <label className="sm:col-span-3">
            <span className="label">変更内容のメモ</span>
            <input className="input" value={v.changeNote} disabled={readOnly} onChange={(e) => upd({ changeNote: e.target.value })} />
          </label>
        </div>
      </section>

      <details className="card mb-4">
        <summary className="cursor-pointer px-4 py-3 font-semibold">差込み項目の一覧（{"{{項目}}"} の形で文章・表に記入）</summary>
        <div className="grid gap-4 p-4 text-sm sm:grid-cols-2">
          <div>
            <h3 className="mb-1 text-sm">項目</h3>
            <ul className="max-h-72 overflow-y-auto">
              {Object.entries(FIELD_LABELS).map(([k, l]) => (
                <li key={k} className="flex gap-2 border-b border-line py-0.5"><code className="text-primary">{`{{${k}}}`}</code><span className="text-muted">{l}</span></li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-1 text-sm">表の行展開元（表ブロックの「行の展開元」で指定）</h3>
            <ul className="max-h-72 overflow-y-auto">
              {Object.entries(LIST_SOURCES).map(([k, s]) => (
                <li key={k} className="border-b border-line py-1">
                  <code className="text-primary">{k}</code> {s.label}
                  <div className="text-xs text-muted">{Object.entries(s.columns).map(([c, l]) => `{{item.${c}}}=${l}`).join("　")}</div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </details>

      <div className="mb-3 flex gap-2">
        <button type="button" className={`btn btn-sm ${!preview ? "btn-primary" : "btn-secondary"}`} onClick={() => setPreview(false)}>本文の編集</button>
        <button type="button" className={`btn btn-sm ${preview ? "btn-primary" : "btn-secondary"}`} onClick={() => setPreview(true)}>プレビュー（変数のまま）</button>
      </div>
      {preview ? (
        <div className="overflow-x-auto bg-bg p-2"><div className="doc-sheet"><DocBlocksView blocks={v.blocks} markMissing={false} /></div></div>
      ) : (
        <BlockEditor blocks={v.blocks} onChange={(blocks) => upd({ blocks })} images={images} templateMode disabled={readOnly} />
      )}

      {!readOnly && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur lg:left-64">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3">
            <span className={`text-sm font-semibold ${{ clean: "text-muted", dirty: "text-warn", saving: "text-primary", saved: "text-ok", failed: "text-danger" }[state]}`} aria-live="polite">
              {{ clean: "変更なし", dirty: "未保存", saving: "保存中…", saved: "保存済み", failed: "保存失敗" }[state]}
            </span>
            <div className="flex gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => router.push("/documents/templates")}>キャンセル</button>
              <button type="button" className="btn btn-primary" disabled={state === "saving"} onClick={save}>
                {state === "saving" ? "保存中…" : initial.status && initial.status !== "draft" ? "新しい版として保存" : "下書き保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
