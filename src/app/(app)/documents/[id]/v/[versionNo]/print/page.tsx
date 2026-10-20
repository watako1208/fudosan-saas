import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffPage, AuthError } from "@/lib/server/session";
import { NotFoundError, audit } from "@/lib/server/repo";
import { adminDb } from "@/lib/server/firebase-admin";
import { C } from "@/lib/types";
import { loadDocument, loadVersion } from "@/lib/server/docgen/access";
import { stripMeta } from "@/lib/server/docgen/engine";
import type { DocumentX, DocVersionX } from "@/lib/server/docgen/model";
import { StateMessage } from "@/components/ui";
import { DocBlocksView, DOC_CSS } from "@/components/documents/DocBlocksView";
import { PrintButton } from "@/components/documents/PrintButton";
import { DOC_STATUS } from "@/lib/labels-documents";

export const metadata = { title: "印刷" };

// 印刷時はアプリの枠（上部バー・左メニュー）を隠し、A4 の帳票だけを出力する
const PRINT_CSS = `
@page { size: A4; margin: 16mm 15mm 18mm 15mm; }
.print-overlay { position: fixed; inset: 0; z-index: 100; overflow: auto; background: #e5e7eb; }
.print-toolbar { position: sticky; top: 0; z-index: 1; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; padding: 8px 16px; background: #fff; border-bottom: 1px solid #e2e5ea; }
.print-overlay .doc-sheet { margin: 16px auto; }
@media print {
  html, body { background: #fff !important; }
  header, aside, nav, .print-toolbar { display: none !important; }
  main { padding: 0 !important; }
  .min-h-screen { min-height: 0 !important; }
  main > div { max-width: none !important; padding: 0 !important; margin: 0 !important; }
  .print-overlay { position: static; overflow: visible; background: #fff; }
  .print-overlay .doc-sheet { width: auto; min-height: 0; margin: 0; padding: 0; box-shadow: none; }
}
`;

export default async function PrintPage({ params }: { params: Promise<{ id: string; versionNo: string }> }) {
  const ctx = await requireStaffPage("document.read");
  const { id, versionNo } = await params;
  const n = Number(versionNo);
  if (!Number.isInteger(n) || n < 1) notFound();
  let d: DocumentX;
  let v: DocVersionX;
  try {
    d = await loadDocument(ctx, id);
    v = await loadVersion(ctx, d, n);
    await adminDb().runTransaction(async (tx) => {
      audit(tx, ctx, "document.export", C.documents, d.id, { format: "print", versionNo: v.versionNo, status: v.status });
    });
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    if (e instanceof AuthError) return <StateMessage kind="forbidden" message={e.message} />;
    console.error("[documents.print]", (e as Error).message);
    return <StateMessage kind="error" message="書類を読み込めませんでした" />;
  }
  const draftLike = v.status !== "issued";
  return (
    <div className="print-overlay">
      <style>{DOC_CSS + PRINT_CSS}</style>
      <div className="print-toolbar">
        <div className="text-sm">
          <span className="font-semibold">{d.number}</span> 第{v.versionNo}版（{DOC_STATUS[v.status]?.label ?? v.status}）
          {draftLike && <span className="ml-2 text-warn">※未発行の版です</span>}
          <span className="ml-2 text-muted">印刷画面で「送信先: PDFに保存」を選ぶとPDFになります</span>
        </div>
        <div className="flex gap-2">
          <Link href={`/documents/${id}`} className="btn btn-secondary">書類に戻る</Link>
          <a href={`/api/documents/${id}/docx?v=${v.versionNo}`} className="btn btn-secondary">Word（DOCX）</a>
          <PrintButton />
        </div>
      </div>
      <div className="doc-sheet">
        <DocBlocksView blocks={(v.blocks ?? []).map(stripMeta)} markMissing={false} />
      </div>
    </div>
  );
}
