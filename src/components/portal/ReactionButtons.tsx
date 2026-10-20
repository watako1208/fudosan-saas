"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { reactToProposal } from "@/lib/server/actions/portal";

/** 提案への回答: 気になる / 内見希望 / 見送り（理由） */
export function ReactionButtons({ proposalId, itemIndex, latest }: { proposalId: string; itemIndex: number; latest: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const rid = useRef(crypto.randomUUID());

  const send = async (kind: "interested" | "viewing_request" | "declined") => {
    setBusy(true);
    setErr(null);
    try {
      const r = await reactToProposal({ proposalId, itemIndex, kind, reason: kind === "declined" ? reason : null, _requestId: rid.current });
      if (!r.ok) setErr(r.errors?.join(" / ") ?? r.error);
      else {
        rid.current = crypto.randomUUID();
        setDeclining(false);
        setReason("");
        router.refresh();
      }
    } catch {
      setErr("通信に失敗しました。再試行してください。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 border-t border-line pt-3">
      {latest && <p className="mb-2 text-sm">前回の回答: <b>{latest}</b></p>}
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-secondary" disabled={busy} onClick={() => send("interested")}>気になる</button>
        <button className="btn btn-primary" disabled={busy} onClick={() => send("viewing_request")}>内見を希望する</button>
        <button className="btn btn-ghost" disabled={busy} onClick={() => setDeclining((v) => !v)}>見送る</button>
      </div>
      {declining && (
        <div className="mt-2 flex flex-wrap gap-2">
          <input className="input flex-1" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="見送りの理由（例: 駅から遠い）" aria-label="見送りの理由" />
          <button className="btn btn-secondary" disabled={busy || !reason.trim()} onClick={() => send("declined")}>見送りを送信</button>
        </div>
      )}
      {err && <p className="mt-1 text-sm text-danger" role="alert">{err}</p>}
    </div>
  );
}
