import { createHash } from "crypto";
import type { Metadata } from "next";
import { col } from "@/lib/server/repo";
import { companyName } from "@/lib/server/lookups";
import { C, ShareLink } from "@/lib/types";
import type { Proposal } from "@/lib/types-deals";
import { StateMessage } from "@/components/ui";
import { ProposalItemCard } from "@/components/portal/ProposalItemCard";
import { isShareable, parseShareToken, shareLinkState } from "@/lib/labels-support";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "物件のご提案", robots: { index: false, follow: false } };

function Invalid({ message }: { message: string }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="card"><StateMessage kind="forbidden" message={message} /></div>
    </main>
  );
}

/**
 * 共有リンクでの提案閲覧（ログイン不要）。提案の公開項目のみを表示する。
 * 契約・精算・本人確認資料・書類は共有リンクの対象外（利用者認証が必要）。
 */
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const parsed = parseShareToken(decodeURIComponent(token));
  if (!parsed) return <Invalid message="リンクが正しくありません。" />;
  const hash = createHash("sha256").update(decodeURIComponent(token)).digest("hex");
  let link: ShareLink | null = null;
  try {
    const s = await col(parsed.companyId, C.shareLinks).doc(hash).get();
    if (s.exists && s.data()!.companyId === parsed.companyId) link = { ...(s.data() as ShareLink), id: s.id };
  } catch {
    return <Invalid message="読み込みに失敗しました。時間をおいて再度お試しください。" />;
  }
  if (!link || !isShareable(link.purpose, link.entity) || link.requiresLogin) return <Invalid message="リンクが正しくないか、共有が終了しています。" />;
  const state = shareLinkState(link, new Date().toISOString());
  if (state !== "active") return <Invalid message={state === "expired" ? "このリンクの有効期限が切れています。担当者にお問い合わせください。" : "このリンクは無効になっています。"} />;
  const ps = await col(parsed.companyId, C.proposals).doc(link.entityId).get();
  const p = ps.exists && ps.data()!.companyId === parsed.companyId ? ({ ...(ps.data() as Proposal), id: ps.id }) : null;
  if (!p || p.archived) return <Invalid message="このご提案は表示できません。" />;
  const company = await companyName(parsed.companyId);
  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <p className="text-sm text-muted">{company}</p>
      <h1 className="mt-1 mb-1 break-words">{p.title || "物件のご提案"}</h1>
      <p className="mb-4 text-sm text-muted">有効期限: {new Date(link.expiresAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</p>
      {p.comment && <p className="card card-pad mb-4 break-words whitespace-pre-wrap">{p.comment}</p>}
      <div className="space-y-4">
        {(p.items ?? []).map((item, i) => (
          <ProposalItemCard key={i} item={item} index={i} />
        ))}
      </div>
      <p className="help mt-6">ご質問・内見のご希望は担当者までご連絡ください。お客様ページをご利用の方はログインすると回答を送信できます。</p>
    </main>
  );
}
