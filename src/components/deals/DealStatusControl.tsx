"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { changeDealStatus } from "@/lib/server/actions/deals";

/** 進行状態の変更。サーバー側で必要項目（顧客・対象物件・契約確定・失注理由）を検証し、不足があれば理由を表示する */
export function DealStatusControl({
  id,
  status,
  statuses,
  version,
  compact,
}: {
  id: string;
  status: string;
  statuses: readonly (readonly [string, string])[];
  version?: number;
  compact?: boolean;
}) {
  const router = useRouter();
  const [to, setTo] = useState(status);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [errs, setErrs] = useState<string[]>([]);
  const needsReason = to === "lost" || to === "closed";
  return (
    <div className={compact ? "space-y-1" : "flex flex-col items-start gap-1"}>
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`st-${id}`}>進行状態</label>
        <select id={`st-${id}`} className={`input !w-auto ${compact ? "!min-h-8 !py-0 text-sm" : ""}`} value={to} onChange={(e) => { setTo(e.target.value); setErrs([]); }}>
          {statuses.map(([k, l]) => (
            <option key={k} value={k}>{l}{k === status ? "（現在）" : ""}</option>
          ))}
        </select>
        <button
          type="button"
          className={`btn btn-secondary ${compact ? "btn-sm" : ""}`}
          disabled={busy || to === status}
          onClick={async () => {
            setBusy(true);
            setErrs([]);
            try {
              const r = await changeDealStatus({ id, to, lostReason: reason, _version: compact ? null : version ?? null });
              if (r.ok) {
                setReason("");
                router.refresh();
              } else setErrs(r.errors?.length ? r.errors : [r.error]);
            } catch {
              setErrs(["通信に失敗しました。再試行してください。"]);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "変更中…" : "状態を変更"}
        </button>
      </div>
      {needsReason && to !== status && (
        <input className="input text-sm" placeholder="失注・終了の理由（必須）" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="失注・終了の理由" />
      )}
      {errs.length > 0 && (
        <ul className="max-w-sm list-disc pl-5 text-xs text-danger" role="alert">
          {errs.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      )}
    </div>
  );
}
