import { NextRequest, NextResponse } from "next/server";
import { getCtx } from "@/lib/server/session";
import { externalScope } from "@/lib/server/portal-access";
import { storeUpload } from "@/lib/server/attachments";
import { companySettings } from "@/lib/server/lookups";
import { col } from "@/lib/server/repo";
import type { Attachment } from "@/lib/types";

export const runtime = "nodejs";

/**
 * 外部利用者の提出（自分の範囲の対象にのみ登録できる）。
 * - 顧客: 自分の関係者（party）への提出資料（社内のみ公開）
 * - 工事業者: 割り当てられた修繕（repair）の写真・資料（業者公開）
 * - 入居者・オーナー: 自分の問い合わせ（inquiry）への写真（社内のみ公開）
 * 登録者は本人。本人確認資料などの機微区分は付けない（社内で区分を変更する）。
 */
export async function POST(req: NextRequest) {
  const ctx = await getCtx();
  if (!ctx || ctx.isStaff) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  const scope = await externalScope(ctx);
  if (!scope) return NextResponse.json({ error: "ご利用者の情報が登録されていません" }, { status: 403 });
  const fd = await req.formData();
  const entity = String(fd.get("entity") ?? "");
  const entityId = String(fd.get("entityId") ?? "");
  let visibility: Attachment["visibility"] = "internal";
  let allowed = false;
  if (scope.kind === "customer" && entity === "party" && entityId === scope.partyId) allowed = true;
  if (scope.kind === "vendor" && entity === "repair" && scope.repairIds.has(entityId)) {
    const r = await col(ctx.companyId, "repairs").doc(entityId).get();
    allowed = r.exists && r.data()!.companyId === ctx.companyId && r.data()!.vendorPartyId === scope.partyId;
    visibility = "vendor";
  }
  if ((scope.kind === "tenant" || scope.kind === "owner") && entity === "inquiry" && scope.inquiryIds.has(entityId)) allowed = true;
  if (!allowed) return NextResponse.json({ error: "この対象へ提出する権限がありません" }, { status: 403 });

  const files = fd.getAll("files").filter((f): f is File => typeof f !== "string");
  const settings = await companySettings(ctx.companyId);
  const max = Math.min(settings.fileMaxCount ?? 50, 20);
  if (files.length === 0) return NextResponse.json({ error: "ファイルを選択してください" }, { status: 400 });
  if (files.length > max) return NextResponse.json({ error: `一度に提出できるのは${max}件までです` }, { status: 400 });
  const category = String(fd.get("category") ?? "提出資料").slice(0, 30) || "提出資料";
  const description = String(fd.get("description") ?? "").slice(0, 200) || null;

  const results = [];
  for (const file of files) {
    results.push(await storeUpload(ctx, { file, entity, entityId, category, visibility, sensitive: false, description, takenAt: null }));
  }
  return NextResponse.json({ results });
}
