import { notFound } from "next/navigation";
import { requireStaffPage } from "@/lib/server/session";
import { getDoc } from "@/lib/server/repo";
import { companyName } from "@/lib/server/lookups";
import { staffName } from "@/lib/server/lookups";
import { C, Deal, Party } from "@/lib/types";
import type { Proposal } from "@/lib/types-deals";
import { ProposalCompare } from "@/components/deals/ProposalCompare";
import { PrintButton } from "@/components/deals/PrintButton";
import { todayJst } from "@/lib/domain/dates";

export const metadata = { title: "物件比較表（印刷）" };

/** 印刷用ページ（A4）。ブラウザの印刷機能から PDF として保存する */
export default async function ProposalPrintPage({ params }: { params: Promise<{ id: string; pid: string }> }) {
  const ctx = await requireStaffPage("deal.read");
  const { id, pid } = await params;
  const deal = await getDoc<Deal>(ctx, C.deals, id);
  const p = await getDoc<Proposal>(ctx, C.proposals, pid);
  if (!deal || !p || p.dealId !== id) notFound();
  const customer = deal.customerId ? await getDoc<Party>(ctx, C.parties, deal.customerId) : null;
  const company = await companyName(ctx.companyId);
  return (
    <>
      <style>{`
        @page { size: A4 landscape; margin: 12mm; }
        @media print {
          body * { visibility: hidden !important; }
          #print-root, #print-root * { visibility: visible !important; }
          #print-root { position: absolute; left: 0; top: 0; width: 100%; padding: 0 !important; border: 0 !important; }
          .no-print { display: none !important; }
          #print-root .compare-table { font-size: 10pt; }
          #print-root .compare-table th, #print-root .compare-table td { padding: 4px 6px; }
          #print-root tr, #print-root td { break-inside: avoid; }
          #print-root .overflow-x-auto { overflow: visible !important; }
        }
      `}</style>
      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        <PrintButton />
        <span className="help">印刷画面で「PDFに保存」を選ぶとPDFとして保存できます（A4横）。</span>
      </div>
      <div id="print-root" className="card mx-auto max-w-[297mm] bg-white p-6">
        <header className="mb-4 flex flex-wrap items-end justify-between gap-2 border-b border-line pb-3">
          <div>
            <p className="text-sm">{customer ? `${customer.name} 様` : ""}</p>
            <h1 className="text-xl">{p.title}</h1>
          </div>
          <div className="text-right text-sm">
            <p>{company}</p>
            <p>担当: {await staffName(ctx, deal.assigneeUid)}</p>
            <p>作成日: {todayJst()}</p>
          </div>
        </header>
        {p.comment && <p className="mb-4 whitespace-pre-wrap text-sm">{p.comment}</p>}
        <ProposalCompare p={p} showReactions={false} />
        <p className="mt-3 text-xs text-muted">※ 記載の条件は各候補の条件取得日時点のものです。最新の条件・空き状況は担当者にご確認ください。</p>
      </div>
    </>
  );
}
