import Link from "next/link";
import { requireExternalPage } from "@/lib/server/portal-access";
import { getDoc } from "@/lib/server/repo";
import { C } from "@/lib/types";
import type { Proposal } from "@/lib/types-deals";
import { StateMessage } from "@/components/ui";
import { NoScope } from "@/components/portal/Guard";
import { ProposalItemCard } from "@/components/portal/ProposalItemCard";
import { ReactionButtons } from "@/components/portal/ReactionButtons";
import { REACTION, lbl } from "@/lib/labels-support";
import { formatDateTimeJst } from "@/lib/domain/dates";

export const metadata = { title: "ご提案" };

export default async function PortalProposal({ params }: { params: Promise<{ id: string }> }) {
  const { ctx, scope } = await requireExternalPage();
  if (!scope) return <NoScope />;
  const { id } = await params;
  const p = scope.kind === "customer" && scope.proposalIds.has(id) ? await getDoc<Proposal>(ctx, C.proposals, id) : null;
  if (!p || p.customerId !== scope.partyId || !p.publishedToCustomer) {
    return <div className="card"><StateMessage kind="forbidden" message="このご提案は表示できません（公開が終了したか、閲覧権限がありません）" /></div>;
  }
  // 本人の回答のみ表示
  const mine = (p.reactions ?? []).filter((r) => r.byUid === ctx.uid);
  return (
    <>
      <Link href="/portal/proposals" className="text-sm text-primary hover:underline">← ご提案一覧</Link>
      <h1 className="mt-1 mb-1 break-words">{p.title || "物件のご提案"}</h1>
      <p className="mb-4 text-sm text-muted">公開日 {formatDateTimeJst(p.publishedAt ?? p.updatedAt)}</p>
      {p.comment && <p className="card card-pad mb-4 break-words whitespace-pre-wrap">{p.comment}</p>}
      <div className="space-y-4">
        {(p.items ?? []).map((item, i) => {
          const last = [...mine].reverse().find((r) => r.itemIndex === i);
          return (
            <ProposalItemCard key={i} item={item} index={i}>
              <ReactionButtons
                proposalId={p.id}
                itemIndex={i}
                latest={last ? `${lbl(REACTION, last.kind)}${last.reason ? `（${last.reason}）` : ""}・${formatDateTimeJst(last.at)}` : null}
              />
            </ProposalItemCard>
          );
        })}
      </div>
      <p className="help mt-4">回答は担当者に通知されます。内見の日時は担当者からご連絡します。</p>
    </>
  );
}
