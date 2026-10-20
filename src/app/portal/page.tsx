import Link from "next/link";
import type { ReactNode } from "react";
import { requireExternalPage } from "@/lib/server/portal-access";
import { getMany } from "@/lib/server/repo";
import { C, Inquiry } from "@/lib/types";
import { NoScope } from "@/components/portal/Guard";
import type { EstimateExt, RepairExt } from "@/lib/labels-support";

export const metadata = { title: "ホーム" };

function Tile({ href, label, count, note }: { href: string; label: string; count?: number; note?: string }) {
  return (
    <Link href={href} className="card block p-4 hover:border-primary">
      <p className="text-sm text-muted">{label}</p>
      {count !== undefined && <p className="mt-1 text-2xl font-bold">{count}<span className="ml-1 text-sm font-normal">件</span></p>}
      {note && <p className="help">{note}</p>}
    </Link>
  );
}

export default async function PortalHome() {
  const { ctx, scope } = await requireExternalPage();
  if (!scope) return <NoScope />;
  const tiles: ReactNode[] = [];
  if (scope.kind === "customer") {
    tiles.push(<Tile key="p" href="/portal/proposals" label="ご提案" count={scope.proposalIds.size} />);
    tiles.push(<Tile key="d" href="/portal/documents" label="書類" count={scope.documentIds.size} />);
    tiles.push(<Tile key="u" href="/portal/uploads" label="提出資料" note="必要書類をこちらから提出できます" />);
  }
  if (scope.kind === "tenant" || scope.kind === "owner") {
    const inqs = await getMany<Inquiry>(ctx, C.inquiries, [...scope.inquiryIds].slice(0, 300));
    const open = [...inqs.values()].filter((i) => i.status !== "done").length;
    if (scope.kind === "tenant") tiles.push(<Tile key="c" href="/portal/contracts" label="ご契約" count={scope.contractIds.size} />);
    tiles.push(<Tile key="i" href="/portal/inquiries" label="対応中の問い合わせ" count={open} note="設備の不具合などはこちらからご連絡ください" />);
    tiles.push(<Tile key="d" href="/portal/documents" label="書類" count={scope.documentIds.size} />);
  }
  if (scope.kind === "owner") {
    const ests = await getMany<EstimateExt>(ctx, C.estimates, [...scope.estimateIds].slice(0, 300));
    const waiting = [...ests.values()].filter((e) => e.status === "submitted" && e.ownerApprovalRequested && (e.ownerPartyIds ?? []).includes(scope.partyId)).length;
    tiles.push(<Tile key="e" href="/portal/estimates" label="承認依頼中の見積" count={waiting} />);
    tiles.push(<Tile key="s" href="/portal/settlements" label="収支報告" note="公開済みの精算報告をご確認いただけます" />);
  }
  if (scope.kind === "vendor") {
    const reps = await getMany<RepairExt>(ctx, C.repairs, [...scope.repairIds].slice(0, 300));
    const active = [...reps.values()].filter((r) => !["completed", "cancelled"].includes(r.status)).length;
    tiles.push(<Tile key="r" href="/portal/repairs" label="対応中のご依頼" count={active} />);
  }
  return (
    <>
      <h1 className="mb-4">ようこそ、{ctx.user.displayName} 様</h1>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{tiles}</div>
      <p className="help mt-6">このページには、お客様に公開された情報のみが表示されます。</p>
    </>
  );
}
