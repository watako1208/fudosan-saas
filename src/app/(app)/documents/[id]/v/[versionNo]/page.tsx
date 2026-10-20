import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffPage, AuthError } from "@/lib/server/session";
import { NotFoundError } from "@/lib/server/repo";
import { staffNameMap } from "@/lib/server/lookups";
import { loadDocument, loadVersion } from "@/lib/server/docgen/access";
import { stripMeta } from "@/lib/server/docgen/engine";
import { DetailHeader, Badge, StateMessage } from "@/components/ui";
import { DocBlocksView, DOC_CSS } from "@/components/documents/DocBlocksView";
import { lbl, tone } from "@/lib/labels";
import { DOC_STATUS, docTypeLabel } from "@/lib/labels-documents";
import { formatDateTimeJst } from "@/lib/domain/dates";

export const metadata = { title: "書類の版" };

/** 過去の版の閲覧（発行済みの旧版を含む。読み取り専用） */
export default async function DocumentVersionPage({ params }: { params: Promise<{ id: string; versionNo: string }> }) {
  const ctx = await requireStaffPage("document.read");
  const { id, versionNo } = await params;
  const n = Number(versionNo);
  if (!Number.isInteger(n) || n < 1) notFound();
  try {
    const d = await loadDocument(ctx, id);
    const v = await loadVersion(ctx, d, n);
    const names = await staffNameMap(ctx);
    return (
      <>
        <style>{DOC_CSS}</style>
        <DetailHeader
          back={{ href: `/documents/${id}?tab=versions`, label: "版の一覧" }}
          number={d.number}
          title={`${d.title}（第${v.versionNo}版）`}
          badges={
            <>
              <Badge>{docTypeLabel(d.docType)}</Badge>
              <Badge tone={tone(DOC_STATUS, v.status)}>{lbl(DOC_STATUS, v.status)}</Badge>
              {v.frozen && <Badge>固定</Badge>}
              {v.supersededBy && <Badge>旧版</Badge>}
            </>
          }
          meta={
            <>
              <span>差込み時点: {formatDateTimeJst(v.sourceUpdatedAt)}</span>
              {v.issuedAt && <span>発行: {formatDateTimeJst(v.issuedAt)} {names.get(v.issuedBy ?? "") ?? ""}</span>}
            </>
          }
          actions={
            <>
              <Link href={`/documents/${id}/v/${v.versionNo}/print`} className="btn btn-secondary" target="_blank">印刷・PDF</Link>
              <a href={`/api/documents/${id}/docx?v=${v.versionNo}`} className="btn btn-secondary">Word（DOCX）</a>
            </>
          }
        />
        <div className="overflow-x-auto bg-bg p-2"><div className="doc-sheet"><DocBlocksView blocks={(v.blocks ?? []).map(stripMeta)} /></div></div>
      </>
    );
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    if (e instanceof AuthError) return <StateMessage kind="forbidden" message={e.message} />;
    console.error("[documents.version]", (e as Error).message);
    return <StateMessage kind="error" message="書類を読み込めませんでした" />;
  }
}
