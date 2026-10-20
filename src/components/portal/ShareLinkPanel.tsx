"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createProposalShareLink, revokeShareLink, listProposalShareLinks } from "@/lib/server/actions/portal";

/**
 * 提案の共有リンク（社内用パネル）。リンクは有効期限つきで、いつでも失効できる。
 * 共有リンクで閲覧できるのは提案の公開項目のみ（契約・精算・本人確認資料は共有リンクの対象外）。
 * 使い方: 提案詳細などに <ShareLinkPanel proposalId={id} /> を置く（deal.write 権限が必要）。
 */
export function ShareLinkPanel({ proposalId }: { proposalId: string }) {
  const [links, setLinks] = useState<{ id: string; expiresAt: string; revoked: boolean; createdAt: string }[]>([]);
  const [days, setDays] = useState(7);
  const [created, setCreated] = useState<{ url: string; expiresAt: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const rid = useRef(crypto.randomUUID());

  const load = useCallback(() => {
    listProposalShareLinks(proposalId).then(setLinks).catch(() => setErr("共有リンクの一覧を読み込めませんでした"));
  }, [proposalId]);
  useEffect(load, [load]);

  const now = new Date().toISOString();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="label">有効期間</span>
          <select className="input !w-auto" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[1, 3, 7, 14, 30].map((d) => <option key={d} value={d}>{d}日間</option>)}
          </select>
        </label>
        <button
          className="btn btn-primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            setCopied(false);
            const r = await createProposalShareLink({ proposalId, days, _requestId: rid.current });
            setBusy(false);
            if (!r.ok) return setErr(r.error);
            rid.current = crypto.randomUUID();
            setCreated(r.data);
            load();
          }}
        >
          共有リンクを作成
        </button>
      </div>
      {created && (
        <div className="rounded-md border border-primary/30 bg-primary-soft p-3 text-sm">
          <p className="font-semibold">共有リンク（この画面でのみ表示します）</p>
          <p className="mt-1 break-all">{location.origin}{created.url}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              className="btn btn-secondary btn-sm"
              onClick={async () => {
                await navigator.clipboard.writeText(location.origin + created.url);
                setCopied(true);
              }}
            >
              コピー
            </button>
            {copied && <span className="text-ok">コピーしました</span>}
            <span className="text-muted">有効期限: {new Date(created.expiresAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</span>
          </div>
          <p className="help">リンクを知っている人は提案の公開項目を閲覧できます。送付はお客様の連絡手段で行ってください（このシステムからは送信しません）。</p>
        </div>
      )}
      {err && <p className="text-sm text-danger" role="alert">{err}</p>}
      {links.length > 0 && (
        <table className="table">
          <thead><tr><th>作成日時</th><th>有効期限</th><th>状態</th><th></th></tr></thead>
          <tbody>
            {links.map((l) => {
              const state = l.revoked ? "失効済み" : l.expiresAt <= now ? "期限切れ" : "有効";
              return (
                <tr key={l.id}>
                  <td>{new Date(l.createdAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</td>
                  <td>{new Date(l.expiresAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</td>
                  <td>{state}</td>
                  <td>
                    {state === "有効" && (
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={async () => {
                          if (!window.confirm("この共有リンクを失効させますか？")) return;
                          const r = await revokeShareLink({ id: l.id });
                          if (!r.ok) setErr(r.error);
                          load();
                        }}
                      >
                        失効
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
