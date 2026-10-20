import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffPage, canAccessStore } from "@/lib/server/session";
import { getDoc } from "@/lib/server/repo";
import { saveProposal, publishProposal, archiveProposal } from "@/lib/server/actions/proposals";
import { C, Deal, Party } from "@/lib/types";
import type { Proposal } from "@/lib/types-deals";
import { DetailHeader, Card, Badge } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { ProposalEditor } from "@/components/deals/ProposalEditor";
import { ProposalCompare } from "@/components/deals/ProposalCompare";
import { formatDateTimeJst } from "@/lib/domain/dates";

export const metadata = { title: "物件提案" };

export default async function ProposalPage({ params }: { params: Promise<{ id: string; pid: string }> }) {
  const ctx = await requireStaffPage("deal.read");
  const { id, pid } = await params;
  const deal = await getDoc<Deal>(ctx, C.deals, id);
  const p = await getDoc<Proposal>(ctx, C.proposals, pid);
  if (!deal || !p || p.dealId !== id || p.archived) notFound();
  const customer = deal.customerId ? await getDoc<Party>(ctx, C.parties, deal.customerId) : null;
  const canEdit = ctx.caps.has("deal.write") && canAccessStore(ctx, deal.storeId);
  return (
    <>
      <DetailHeader
        back={{ href: `/deals/${id}?tab=proposals`, label: `${deal.number} ${deal.title}` }}
        title={p.title}
        badges={p.publishedToCustomer ? <Badge tone="info">顧客ページに公開中</Badge> : <Badge>未公開</Badge>}
        meta={
          <>
            <span>顧客: {customer?.name ?? "未設定"}</span>
            <span>候補 {p.items.length}件</span>
            {p.publishedAt && <span>公開: {formatDateTimeJst(p.publishedAt)}</span>}
          </>
        }
        actions={
          <>
            <Link className="btn btn-secondary" href={`/deals/${id}/proposals/${pid}/print`}>印刷・PDF</Link>
            {canEdit && (
              <ActionButton
                action={publishProposal}
                args={{ id: pid, publish: !p.publishedToCustomer }}
                label={p.publishedToCustomer ? "公開を停止" : "顧客ページに公開"}
                variant={p.publishedToCustomer ? "secondary" : "primary"}
                confirm={p.publishedToCustomer ? "顧客ページでの公開を停止しますか？" : `${customer?.name ?? "顧客"}様の顧客ページ（自社システム内）で閲覧できるようにします。よろしいですか？`}
              />
            )}
            {canEdit && <ActionButton action={archiveProposal} args={{ id: pid }} label="アーカイブ" confirm="この提案をアーカイブしますか？（公開中の場合は非公開になります）" />}
          </>
        }
      />
      <Card title="物件比較表" className="mb-4">
        <ProposalCompare p={p} />
        <p className="help mt-2">賃料・価格などは候補を追加した時点の募集条件です。募集条件を変更しても提案内容は自動では変わりません。</p>
      </Card>
      {canEdit && (
        <ProposalEditor
          action={saveProposal.bind(null, pid)}
          initial={{ title: p.title, comment: p.comment ?? "" }}
          version={p.version}
          items={p.items.map((it) => ({ propertyId: it.propertyId, unitId: it.unitId, label: `${it.propertyName}${it.unitNumber ? ` ${it.unitNumber}` : "（物件全体）"}`, comment: it.comment }))}
          cancelHref={`/deals/${id}?tab=proposals`}
        />
      )}
    </>
  );
}
