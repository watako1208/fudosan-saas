"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/server/action";

/**
 * 単発の操作ボタン（確定・承認・アーカイブなど）。
 * 処理識別番号を付けて送信し、連打や再試行でも重複実行しない。
 * prompt を指定すると理由などの入力を求める（差戻し理由・締め解除理由など）。
 */
export function ActionButton({
  action,
  args = {},
  label,
  confirm,
  prompt,
  promptRequired = true,
  variant = "secondary",
  size,
  redirectTo,
  disabled,
  disabledReason,
}: {
  action: (input: Record<string, unknown>) => Promise<ActionResult<unknown>>;
  args?: Record<string, unknown>;
  label: string;
  confirm?: string;
  prompt?: string;
  promptRequired?: boolean;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm";
  redirectTo?: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const rid = useRef<string>(crypto.randomUUID());
  return (
    <span className="inline-flex flex-col items-start">
      <button
        type="button"
        className={`btn btn-${variant} ${size === "sm" ? "btn-sm" : ""}`}
        disabled={busy || disabled}
        title={disabled ? disabledReason : undefined}
        onClick={async () => {
          let reason: string | null = null;
          if (prompt) {
            reason = window.prompt(prompt);
            if (reason === null) return;
            if (promptRequired && !reason.trim()) {
              setErr("理由の入力が必要です");
              return;
            }
          }
          if (confirm && !window.confirm(confirm)) return;
          setBusy(true);
          setErr(null);
          try {
            const r = await action({ ...args, reason, _requestId: rid.current });
            if (!r.ok) {
              setErr(r.errors?.length ? r.errors.join(" / ") : r.error);
              if (r.code === "reauth_required") router.push(`/login?reauth=1&next=${encodeURIComponent(location.pathname)}`);
            } else {
              rid.current = crypto.randomUUID();
              const to = (r.data as { redirect?: string } | null)?.redirect ?? redirectTo;
              if (to) router.push(to);
              else router.refresh();
            }
          } catch {
            setErr("通信に失敗しました。再試行してください。");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "処理中…" : label}
      </button>
      {disabled && disabledReason && <span className="mt-1 max-w-xs text-xs text-muted">{disabledReason}</span>}
      {err && <span className="mt-1 max-w-sm text-xs text-danger" role="alert">{err}</span>}
    </span>
  );
}
