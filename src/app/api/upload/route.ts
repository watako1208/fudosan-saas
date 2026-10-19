import { NextRequest, NextResponse } from "next/server";
import { getCtx } from "@/lib/server/session";
import { storeUpload, ENTITY_WRITE_CAP, entityCollection } from "@/lib/server/attachments";
import { companySettings } from "@/lib/server/lookups";
import { col } from "@/lib/server/repo";
import type { Attachment } from "@/lib/types";

export const runtime = "nodejs";

const VIS: Attachment["visibility"][] = ["internal", "customer", "owner", "tenant", "vendor", "public_share"];

/** 複数ファイル登録（社内利用者用）。外部利用者の提出は /api/portal/upload を使う */
export async function POST(req: NextRequest) {
  const ctx = await getCtx();
  if (!ctx || !ctx.isStaff) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  const fd = await req.formData();
  const entity = String(fd.get("entity") ?? "");
  const entityId = String(fd.get("entityId") ?? "");
  const cap = ENTITY_WRITE_CAP[entity];
  if (!cap || !ctx.caps.has(cap)) return NextResponse.json({ error: "登録する権限がありません" }, { status: 403 });
  // 関連先が自社データであることを確認（T13）
  const target = await col(ctx.companyId, entityCollection(entity)).doc(entityId).get();
  if (!target.exists || target.data()!.companyId !== ctx.companyId) return NextResponse.json({ error: "関連先が見つかりません" }, { status: 404 });
  const sensitive = fd.get("sensitive") === "true";
  if (sensitive && !ctx.caps.has("party.sensitive")) return NextResponse.json({ error: "本人確認資料を登録する権限がありません" }, { status: 403 });

  const files = fd.getAll("files").filter((f): f is File => typeof f !== "string");
  const settings = await companySettings(ctx.companyId);
  if (files.length === 0) return NextResponse.json({ error: "ファイルを選択してください" }, { status: 400 });
  if (files.length > (settings.fileMaxCount ?? 50)) return NextResponse.json({ error: `一度に登録できるのは${settings.fileMaxCount ?? 50}件までです` }, { status: 400 });
  const visibility = VIS.includes(String(fd.get("visibility")) as Attachment["visibility"]) ? (String(fd.get("visibility")) as Attachment["visibility"]) : "internal";

  const results = [];
  for (const file of files) {
    results.push(
      await storeUpload(ctx, {
        file,
        entity,
        entityId,
        category: String(fd.get("category") ?? "その他"),
        visibility: sensitive ? "internal" : visibility,
        sensitive,
        description: (fd.get("description") as string) || null,
        takenAt: (fd.get("takenAt") as string) || null,
      }),
    );
  }
  return NextResponse.json({ results });
}
