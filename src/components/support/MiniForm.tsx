"use client";
import { ReactNode, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/server/action";

/**
 * 画面内の小さな入力フォーム（対応記録の追記・設定項目・外部利用者ページの申請など）。
 * 処理識別番号を付けて送信し、失敗時は入力を保持して理由を表示する。
 */
export function MiniForm({
  action,
  args = {},
  submitLabel,
  children,
  confirm,
  resetOnSuccess = true,
  successMessage = "保存しました",
  className = "",
  onSuccess,
}: {
  action: (input: Record<string, unknown>) => Promise<ActionResult<unknown>>;
  args?: Record<string, unknown>;
  submitLabel: string;
  children: ReactNode;
  confirm?: string;
  resetOnSuccess?: boolean;
  successMessage?: string;
  className?: string;
  onSuccess?: (data: unknown) => void;
}) {
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const rid = useRef<string>(crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [ok, setOk] = useState<string | null>(null);

  return (
    <form
      ref={ref}
      className={className}
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy || !ref.current) return;
        if (confirm && !window.confirm(confirm)) return;
        const fd = new FormData(ref.current);
        const values: Record<string, unknown> = {};
        for (const [k, v] of fd.entries()) {
          if (typeof v !== "string") continue;
          if (k in values) values[k] = ([] as unknown[]).concat(values[k], v);
          else values[k] = v;
        }
        ref.current.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name]').forEach((cb) => {
          if (!cb.dataset.multi) values[cb.name] = cb.checked;
        });
        setBusy(true);
        setErrors([]);
        setOk(null);
        try {
          const r = await action({ ...values, ...args, _requestId: rid.current });
          if (!r.ok) {
            setErrors(r.errors?.length ? r.errors : [r.error]);
            if (r.code === "reauth_required") router.push(`/login?reauth=1&next=${encodeURIComponent(location.pathname + location.search)}`);
            return;
          }
          rid.current = crypto.randomUUID();
          setOk(successMessage);
          if (resetOnSuccess) ref.current?.reset();
          onSuccess?.(r.data);
          const to = (r.data as { redirect?: string } | null)?.redirect;
          if (to) router.push(to);
          else router.refresh();
        } catch {
          setErrors(["通信に失敗しました。入力内容は保持されています。再試行してください。"]);
        } finally {
          setBusy(false);
        }
      }}
    >
      {errors.length > 0 && (
        <div className="mb-3 rounded-md border border-danger/30 bg-danger-soft p-3 text-sm text-danger" role="alert">
          <ul className="list-disc pl-5">
            {errors.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </div>
      )}
      {children}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "送信中…" : submitLabel}
        </button>
        {ok && <span className="text-sm text-ok" aria-live="polite">{ok}</span>}
      </div>
    </form>
  );
}
