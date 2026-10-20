"use client";
import { ReactNode, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/server/action";

/**
 * 画面内の小さな入力フォーム（送金記録・過入金の扱い・締め月の指定など）。
 * 下部固定バーを持たないため、1画面に複数置ける。処理識別番号を付けて二重送信を防ぐ。
 */
export function InlineForm({
  action,
  hidden = {},
  submitLabel,
  confirm,
  children,
  variant = "primary",
  resetOnSuccess = true,
  successMessage,
  redirectTo,
}: {
  action: (v: Record<string, unknown>) => Promise<ActionResult<unknown>>;
  hidden?: Record<string, unknown>;
  submitLabel: string;
  confirm?: string;
  children?: ReactNode;
  variant?: "primary" | "secondary" | "danger";
  resetOnSuccess?: boolean;
  successMessage?: string;
  redirectTo?: string;
}) {
  const router = useRouter();
  const rid = useRef<string>(crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [ok, setOk] = useState<string | null>(null);
  return (
    <form
      className="space-y-3"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        if (confirm && !window.confirm(confirm)) return;
        const form = e.currentTarget;
        const fd = new FormData(form);
        const values: Record<string, unknown> = { ...hidden };
        for (const [k, v] of fd.entries()) if (typeof v === "string") values[k] = v;
        form.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name]').forEach((cb) => (values[cb.name] = cb.checked));
        setBusy(true);
        setErrors([]);
        setOk(null);
        try {
          const r = await action({ ...values, _requestId: rid.current });
          if (!r.ok) {
            setErrors(r.errors?.length ? r.errors : [r.error]);
            if (r.code === "reauth_required") router.push(`/login?reauth=1&next=${encodeURIComponent(location.pathname)}`);
          } else {
            rid.current = crypto.randomUUID();
            if (resetOnSuccess) form.reset();
            setOk(successMessage ?? "保存しました");
            const to = (r.data as { redirect?: string } | null)?.redirect ?? redirectTo;
            if (to) router.push(to);
            else router.refresh();
          }
        } catch {
          setErrors(["通信に失敗しました。入力内容は保持されています。再試行してください。"]);
        } finally {
          setBusy(false);
        }
      }}
    >
      {errors.length > 0 && (
        <div className="rounded-md border border-danger/30 bg-danger-soft p-3 text-sm text-danger" role="alert">
          <ul className="list-disc pl-5">
            {errors.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </div>
      )}
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={`btn btn-${variant}`} disabled={busy}>
          {busy ? "処理中…" : submitLabel}
        </button>
        {ok && !busy && <span className="text-sm text-ok" aria-live="polite">{ok}</span>}
      </div>
    </form>
  );
}

/** InlineForm 用の簡易入力項目 */
export function Input({ name, label, type = "text", defaultValue, required, help, placeholder, inputMode }: {
  name: string; label: string; type?: string; defaultValue?: string | number | null; required?: boolean; help?: string; placeholder?: string; inputMode?: "numeric" | "text";
}) {
  return (
    <div>
      <label className="label" htmlFor={`if-${name}`}>
        {label}
        {required && <span className="ml-1 text-xs text-danger">必須</span>}
      </label>
      <input id={`if-${name}`} name={name} type={type} className="input" defaultValue={defaultValue ?? ""} placeholder={placeholder} inputMode={inputMode} />
      {help && <p className="help">{help}</p>}
    </div>
  );
}

export function Select({ name, label, options, defaultValue, required, emptyLabel }: {
  name: string; label: string; options: { value: string; label: string }[]; defaultValue?: string | null; required?: boolean; emptyLabel?: string;
}) {
  return (
    <div>
      <label className="label" htmlFor={`if-${name}`}>
        {label}
        {required && <span className="ml-1 text-xs text-danger">必須</span>}
      </label>
      <select id={`if-${name}`} name={name} className="input" defaultValue={defaultValue ?? ""}>
        {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}
