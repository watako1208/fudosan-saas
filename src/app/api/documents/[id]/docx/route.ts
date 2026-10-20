import { NextRequest, NextResponse } from "next/server";
import { getCtx, AuthError } from "@/lib/server/session";
import { getDoc, NotFoundError, audit } from "@/lib/server/repo";
import { staffCanView } from "@/lib/server/attachments";
import { adminBucket, adminDb } from "@/lib/server/firebase-admin";
import { C, Attachment } from "@/lib/types";
import { loadDocument, loadVersion } from "@/lib/server/docgen/access";
import { stripMeta } from "@/lib/server/docgen/engine";
import { renderDocx, imageInfo, LoadedImage } from "@/lib/server/docgen/docx";
import type { DocumentX, DocVersionX } from "@/lib/server/docgen/model";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

/** 書類の DOCX 出力。会社・利用者・差込み元・添付ファイルの権限をサーバー側で毎回確認する */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return new NextResponse("ログインが必要です", { status: 401 });
  if (!ctx.isStaff || !ctx.caps.has("document.read")) return new NextResponse("閲覧する権限がありません", { status: 403 });
  const { id } = await params;
  const vParam = req.nextUrl.searchParams.get("v");
  const n = vParam ? Number(vParam) : null;
  if (n !== null && (!Number.isInteger(n) || n < 1)) return new NextResponse("版の指定が正しくありません", { status: 400 });
  let d: DocumentX;
  let v: DocVersionX;
  try {
    d = await loadDocument(ctx, id);
    v = await loadVersion(ctx, d, n);
  } catch (e) {
    if (e instanceof NotFoundError) return new NextResponse("見つからないか、閲覧権限がありません", { status: 404 });
    if (e instanceof AuthError) return new NextResponse(e.message, { status: 403 });
    console.error("[documents.docx]", (e as Error).message);
    return new NextResponse("書類を読み込めませんでした", { status: 500 });
  }

  const loadImage = async (attachmentId: string): Promise<LoadedImage | null | "unsupported"> => {
    const a = await getDoc<Attachment>(ctx, C.attachments, attachmentId);
    if (!a || a.archived || !staffCanView(ctx, a) || !a.contentType.startsWith("image/")) return null;
    if (a.contentType === "image/webp") return "unsupported";
    if (a.size > MAX_IMAGE_BYTES) return null;
    try {
      const [buf] = await adminBucket().file(a.storagePath).download();
      const info = imageInfo(buf);
      if (!info) return null;
      return { data: buf, ...info };
    } catch (e) {
      console.error("[documents.docx.image]", (e as Error).message);
      return null;
    }
  };

  let buf: Buffer;
  try {
    buf = await renderDocx((v.blocks ?? []).map(stripMeta), { title: d.title, loadImage });
  } catch (e) {
    console.error("[documents.docx.render]", (e as Error).message);
    return new NextResponse("DOCXの作成に失敗しました。時間をおいて再試行してください。", { status: 500 });
  }
  await adminDb().runTransaction(async (tx) => {
    audit(tx, ctx, "document.export", C.documents, d.id, { format: "docx", versionNo: v.versionNo, status: v.status });
  });
  const fileName = `${d.number}_${d.title}_第${v.versionNo}版.docx`.replace(/[\\/:*?"<>|]/g, "_");
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "content-disposition": `attachment; filename="document.docx"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
