import { NextRequest, NextResponse } from "next/server";
import { getCtx } from "@/lib/server/session";
import { staffCanView } from "@/lib/server/attachments";
import { externalCanViewAttachment } from "@/lib/server/portal-access";
import { adminBucket } from "@/lib/server/firebase-admin";
import { col } from "@/lib/server/repo";
import type { Attachment } from "@/lib/types";

export const runtime = "nodejs";

/** 添付ファイルの閲覧。毎回、会社・利用者・対象データの権限を確認する */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  if (!ctx) return new NextResponse("ログインが必要です", { status: 401 });
  if (!id || id.includes("/")) return new NextResponse("見つかりません", { status: 404 });
  const snap = await col(ctx.companyId, "attachments").doc(id).get();
  if (!snap.exists) return new NextResponse("見つからないか、閲覧権限がありません", { status: 404 });
  const a = { ...(snap.data() as Attachment), id: snap.id };
  const allowed = ctx.isStaff ? staffCanView(ctx, a) : await externalCanViewAttachment(ctx, a);
  if (!allowed || a.quarantined) return new NextResponse("見つからないか、閲覧権限がありません", { status: 404 });
  const [buf] = await adminBucket().file(a.storagePath).download();
  const inline = req.nextUrl.searchParams.get("download") !== "1" && (a.contentType.startsWith("image/") || a.contentType === "application/pdf");
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "content-type": a.contentType,
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(a.fileName)}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
