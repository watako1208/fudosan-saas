"use client";
import { createContext, ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/server/action";

type SaveState = "clean" | "dirty" | "saving" | "saved" | "failed";

interface Ctx {
  errors: Record<string, string>;
  initial: Record<string, unknown>;
  markDirty: () => void;
}
const FormCtx = createContext<Ctx>({ errors: {}, initial: {}, markDirty: () => {} });
export const useFormCtx = () => useContext(FormCtx);

export interface SubmitButton {
  label: string;
  intent: string;
  primary?: boolean;
  confirm?: string;
}

/** FormData → オブジェクト（同名複数は配列） */
function collect(form: HTMLFormElement): Record<string, unknown> {
  const fd = new FormData(form);
  const out: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v !== "string") continue;
    if (k in out) out[k] = ([] as unknown[]).concat(out[k], v);
    else out[k] = v;
  }
  form.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name]').forEach((cb) => {
    if (!cb.dataset.multi) out[cb.name] = cb.checked;
  });
  return out;
}

function newRequestId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

/**
 * 編集フォーム共通:
 * - 保存状態を文字で表示（未保存/保存中/保存済み/保存失敗）
 * - 下部に「保存」「キャンセル」を固定表示
 * - 未保存のまま移動する際に確認
 * - 必須不足は項目直下と画面上部の件数で表示
 * - 同時編集の競合時は上書きせず、比較・再読込を提示
 * - 保存失敗時も入力は保持し再試行できる
 */
export function EditForm({
  action,
  initial = {},
  version,
  cancelHref,
  buttons = [{ label: "保存", intent: "save", primary: true }],
  children,
  fieldLabels = {},
  onSavedRedirect = true,
}: {
  action: (values: Record<string, unknown>) => Promise<ActionResult<{ redirect?: string } | null | unknown>>;
  initial?: Record<string, unknown>;
  version?: number;
  cancelHref?: string;
  buttons?: SubmitButton[];
  children: ReactNode;
  fieldLabels?: Record<string, string>;
  onSavedRedirect?: boolean;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<SaveState>("clean");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<string[]>([]);
  const [conflict, setConflict] = useState<Record<string, unknown> | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const requestId = useRef(newRequestId());
  const dirty = state === "dirty" || state === "failed";

  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    const onClick = (e: MouseEvent) => {
      if (!dirty) return;
      const a = (e.target as HTMLElement).closest("a");
      if (a && a.href && !a.target && !a.hasAttribute("download")) {
        if (!window.confirm("保存していない変更があります。移動すると変更は失われます。移動しますか？")) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  const submit = async (b: SubmitButton) => {
    if (!formRef.current || state === "saving") return;
    if (b.confirm && !window.confirm(b.confirm)) return;
    const values = collect(formRef.current);
    setState("saving");
    setSummary([]);
    setErrors({});
    let r: Awaited<ReturnType<typeof action>>;
    try {
      r = await action({ ...values, _intent: b.intent, _version: version ?? null, _requestId: requestId.current });
    } catch {
      setState("failed");
      setSummary(["通信に失敗しました。入力内容は保持されています。再試行してください。"]);
      return;
    }
    if (r.ok) {
      requestId.current = newRequestId();
      setState("saved");
      const redirect = (r.data as { redirect?: string } | null)?.redirect;
      if (onSavedRedirect && redirect) router.push(redirect);
      else router.refresh();
      return;
    }
    setState("failed");
    if (r.code === "conflict") {
      setConflict((r.latest as Record<string, unknown>) ?? {});
      return;
    }
    if (r.code === "reauth_required") {
      setSummary([r.error]);
      return;
    }
    setErrors(r.fieldErrors ?? {});
    setSummary(r.errors?.length ? r.errors : [r.error]);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const diffRows = useMemo(() => {
    if (!conflict || !formRef.current) return [];
    const mine = collect(formRef.current);
    return Object.keys(mine)
      .filter((k) => !k.startsWith("_"))
      .map((k) => ({ k, before: initial[k], theirs: conflict[k], mine: mine[k] }))
      .filter((x) => JSON.stringify(x.before ?? "") !== JSON.stringify(x.theirs ?? ""));
  }, [conflict, initial]);

  const stateLabel: Record<SaveState, { text: string; cls: string }> = {
    clean: { text: "変更なし", cls: "text-muted" },
    dirty: { text: "未保存", cls: "text-warn" },
    saving: { text: "保存中…", cls: "text-primary" },
    saved: { text: "保存済み", cls: "text-ok" },
    failed: { text: "保存失敗", cls: "text-danger" },
  };

  const ctxValue = useMemo(() => ({ errors, initial, markDirty: () => setState((s) => (s === "saving" ? s : "dirty")) }), [errors, initial]);

  return (
    <FormCtx.Provider value={ctxValue}>
      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          submit(buttons.find((b) => b.primary) ?? buttons[0]);
        }}
        onChange={() => setState((s) => (s === "saving" ? s : "dirty"))}
        onInput={() => setState((s) => (s === "saving" ? s : "dirty"))}
        className="pb-24"
        noValidate
      >
        {summary.length > 0 && (
          <div className="mb-4 rounded-md border border-danger/30 bg-danger-soft p-3 text-sm text-danger" role="alert">
            <p className="font-semibold">{Object.keys(errors).length > 0 ? `${Object.keys(errors).length}件の項目を確認してください` : "保存できませんでした"}</p>
            <ul className="mt-1 list-disc pl-5">
              {summary.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
        )}
        {conflict && (
          <div className="mb-4 rounded-md border border-warn/40 bg-warn-soft p-3 text-sm" role="alert">
            <p className="font-semibold text-warn">他の利用者が先にこのデータを更新しました。上書きを止めています。</p>
            <p className="mt-1">あなたの入力は保持されています。比較してから最新情報を読み直してください。</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowDiff((v) => !v)}>変更箇所を比較</button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => {
                  setState("clean");
                  setTimeout(() => window.location.reload(), 0);
                }}
              >
                最新情報を読み直す
              </button>
            </div>
            {showDiff && (
              <table className="table mt-3 bg-surface">
                <thead>
                  <tr><th>項目</th><th>編集開始時</th><th>他の利用者の更新後</th><th>あなたの入力</th></tr>
                </thead>
                <tbody>
                  {diffRows.length === 0 && (
                    <tr><td colSpan={4} className="text-muted">この画面の項目以外（状態・明細など）が更新されています</td></tr>
                  )}
                  {diffRows.map((d) => (
                    <tr key={d.k}>
                      <td>{fieldLabels[d.k] ?? d.k}</td>
                      <td>{fmtVal(d.before)}</td>
                      <td className="font-semibold">{fmtVal(d.theirs)}</td>
                      <td>{fmtVal(d.mine)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
        {children}
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur lg:left-64">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3">
            <span className={`text-sm font-semibold ${stateLabel[state].cls}`} aria-live="polite">
              {stateLabel[state].text}
            </span>
            <div className="flex flex-wrap gap-2">
              {cancelHref && (
                <button type="button" className="btn btn-secondary" onClick={() => router.push(cancelHref)}>
                  キャンセル
                </button>
              )}
              {buttons.map((b) => (
                <button
                  key={b.intent}
                  type="button"
                  className={`btn ${b.primary ? "btn-primary" : "btn-secondary"}`}
                  disabled={state === "saving"}
                  onClick={() => submit(b)}
                >
                  {state === "saving" ? "保存中…" : b.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </form>
    </FormCtx.Provider>
  );
}

function fmtVal(v: unknown): string {
  if (v === null || v === undefined || v === "") return "（空欄）";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// ───────────── 入力項目 ─────────────

export function Field({ name, label, required, help, children, className = "" }: { name: string; label: string; required?: boolean; help?: string; children: ReactNode; className?: string }) {
  const { errors } = useFormCtx();
  return (
    <div className={className}>
      <label htmlFor={name} className="label">
        {label}
        {required && <span className="ml-1 text-xs text-danger">必須</span>}
      </label>
      {children}
      {help && !errors[name] && <p className="help">{help}</p>}
      {errors[name] && <p className="field-error" id={`${name}-error`}>{errors[name]}</p>}
    </div>
  );
}

function val(initial: Record<string, unknown>, name: string, dv?: unknown): string {
  const v = dv !== undefined ? dv : initial[name];
  return v === null || v === undefined ? "" : String(v);
}

export function TextField({
  name, label, required, help, type = "text", defaultValue, placeholder, className, inputMode, maxLength,
}: {
  name: string; label: string; required?: boolean; help?: string; type?: string; defaultValue?: unknown;
  placeholder?: string; className?: string; inputMode?: "numeric" | "decimal" | "text" | "tel" | "email"; maxLength?: number;
}) {
  const { errors, initial } = useFormCtx();
  return (
    <Field name={name} label={label} required={required} help={help} className={className}>
      <input
        id={name}
        name={name}
        type={type}
        className="input"
        defaultValue={val(initial, name, defaultValue)}
        placeholder={placeholder}
        inputMode={inputMode}
        maxLength={maxLength}
        aria-invalid={!!errors[name]}
        aria-describedby={errors[name] ? `${name}-error` : undefined}
      />
    </Field>
  );
}

export function MoneyField(props: { name: string; label: string; required?: boolean; help?: string; defaultValue?: unknown; className?: string }) {
  return <TextField {...props} inputMode="numeric" placeholder="円" help={props.help ?? "円単位。未入力のままにすると「未入力」として扱います"} />;
}

export function TextArea({ name, label, required, help, rows = 4, defaultValue, className }: { name: string; label: string; required?: boolean; help?: string; rows?: number; defaultValue?: unknown; className?: string }) {
  const { errors, initial } = useFormCtx();
  return (
    <Field name={name} label={label} required={required} help={help} className={className}>
      <textarea id={name} name={name} rows={rows} className="input" defaultValue={val(initial, name, defaultValue)} aria-invalid={!!errors[name]} />
    </Field>
  );
}

export function SelectField({
  name, label, required, help, options, defaultValue, className, allowEmpty = true, emptyLabel = "選択してください",
}: {
  name: string; label: string; required?: boolean; help?: string; options: { value: string; label: string }[];
  defaultValue?: unknown; className?: string; allowEmpty?: boolean; emptyLabel?: string;
}) {
  const { errors, initial } = useFormCtx();
  return (
    <Field name={name} label={label} required={required} help={help} className={className}>
      <select id={name} name={name} className="input" defaultValue={val(initial, name, defaultValue)} aria-invalid={!!errors[name]}>
        {allowEmpty && <option value="">{emptyLabel}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </Field>
  );
}

export function CheckField({ name, label, defaultChecked, help }: { name: string; label: string; defaultChecked?: boolean; help?: string }) {
  const { initial } = useFormCtx();
  return (
    <div>
      <label className="flex min-h-10 items-center gap-2">
        <input type="checkbox" name={name} defaultChecked={defaultChecked ?? !!initial[name]} className="h-4 w-4" />
        <span>{label}</span>
      </label>
      {help && <p className="help">{help}</p>}
    </div>
  );
}

export function FormSection({ title, children, desc }: { title: string; children: ReactNode; desc?: string }) {
  return (
    <section className="card mb-4">
      <div className="border-b border-line px-4 py-3 sm:px-5">
        <h2 className="text-base">{title}</h2>
        {desc && <p className="help">{desc}</p>}
      </div>
      <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-3">{children}</div>
    </section>
  );
}
