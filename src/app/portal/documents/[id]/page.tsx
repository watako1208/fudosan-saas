import Link from "next/link";
import { requireExternalPage } from "@/lib/server/portal-access";
import { getDoc } from "@/lib/server/repo";
import { C, DocumentDoc, DocumentVersion } from "@/lib/types";

type PublishedDoc = DocumentDoc & { issuedVersionId?: string | null; issuedVersionNo?: number | null };
import { StateMessage } from "@/components/ui";
import { NoScope } from "@/components/portal/Guard";
import { DocBlocks } from "@/components/portal/DocBlocks";
import { PrintButton } from "@/components/portal/LogoutButton";
import { formatDateTimeJst } from "@/lib/domain/dates";

export const metadata = { title: "書類" };

/** 外部利用者向けの書類表示（issuedVersionId の発行済み版のみ。版に固定された内容を表示する） */
export default async function PortalDocument({ params }: { params: Promise<{ id: string }> }) {
  const { ctx, scope } = await requireExternalPage();
  if (!scope) return <NoScope />;
  const { id } = await params;
  const d = scope.documentIds.has(id) ? await getDoc<PublishedDoc>(ctx, C.documents, id) : null;
  const ok = d && !!d.issuedVersionId && (d.partyIds ?? []).includes(scope.partyId) && (d.publishedTo ?? []).includes(scope.kind);
  const v = ok && d.issuedVersionId ? await getDoc<DocumentVersion>(ctx, C.documentVersions, d.issuedVersionId) : null;
  if (!ok || !v || v.documentId !== d.id) {
    return <div className="card"><StateMessage kind="forbidden" message="この書類は表示できません（公開が終了したか、閲覧権限がありません）" /></div>;
  }
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href="/portal/documents" className="text-sm text-primary hover:underline">← 書類一覧</Link>
        <PrintButton />
      </div>
      <article className="card card-pad">
        <p className="mb-4 text-xs text-muted">
          {d.number} ／ 第{v.versionNo}版 ／ 発行 {formatDateTimeJst(v.issuedAt)}
        </p>
        <DocBlocks blocks={v.blocks ?? []} />
      </article>
    </>
  );
}
