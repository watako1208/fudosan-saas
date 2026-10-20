"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/server/action";
import { PUBLISH_KIND } from "@/lib/labels-documents";

/** 発行済み書類の外部利用者ページへの公開設定 */
export function PublishForm({
  documentId,
  version,
  candidates,
  current,
  action,
}: {
  documentId: string;
  version: number;
  candidates: { id: string; name: string }[];
  current: { kinds: string[]; partyIds: string[] };
  action: (v: Record<string, unknown>) => Promise<ActionResult<unknown>>;
}) {
  const router = useRouter();
  const [kinds, setKinds] = useState<Set<string>>(new Set(current.kinds));
  const [parties, setParties] = useState<Set<string>>(new Set(current.partyIds));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const rid = useRef(crypto.randomUUID());
  const toggle = (s: Set<string>, k: string, f: (x: Set<string>) => void) => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    f(n);
  };
  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="label">公開先の種別</legend>
        <div className="flex flex-wrap gap-4">
          {Object.entries(PUBLISH_KIND).map(([k, v]) => (
            <label key={k} className="flex min-h-10 items-center gap-2">
              <input type="checkbox" className="h-4 w-4" checked={kinds.has(k)} onChange={() => toggle(kinds, k, setKinds)} />
              {v.label}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="label">公開先の関係者（書類の差込み元に関係する人・法人）</legend>
        {candidates.length === 0 && <p className="text-sm text-muted">公開できる関係者がいません</p>}
        <div className="flex flex-col gap-1">
          {candidates.map((c) => (
            <label key={c.id} className="flex min-h-10 items-center gap-2">
              <input type="checkbox" className="h-4 w-4" checked={parties.has(c.id)} onChange={() => toggle(parties, c.id, setParties)} />
              {c.name}
            </label>
          ))}
        </div>
      </fieldset>
      {err && <p className="text-sm text-danger" role="alert">{err}</p>}
      <button
        type="button"
        className="btn btn-primary"
        disabled={busy}
        onClick={async () => {
          if (!window.confirm("選択した外部利用者のページにこの書類（発行済みの版）を公開します。よろしいですか？")) return;
          setBusy(true);
          setErr(null);
          try {
            const r = await action({ id: documentId, kinds: [...kinds], partyIds: [...parties], _version: version, _requestId: rid.current });
            if (!r.ok) setErr(r.errors?.length ? r.errors.join(" / ") : r.error);
            else {
              rid.current = crypto.randomUUID();
              router.refresh();
            }
          } catch {
            setErr("通信に失敗しました。再試行してください。");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "処理中…" : "公開設定を保存"}
      </button>
    </div>
  );
}
