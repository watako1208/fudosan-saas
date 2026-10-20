import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { adminDb } from "@/lib/server/firebase-admin";
import { runDailyJobs } from "@/lib/server/jobs/runner";
import { todayJst } from "@/lib/domain/dates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function secretOk(given: string | null): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  if (!secret || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * 定期処理（Cloud Scheduler などから毎日 POST する）。
 * ヘッダー x-cron-secret が CRON_SECRET と一致する場合のみ実行する。
 * 全会社について 翌月分の月次請求・更新対象の抽出・期限通知 を実行し、JobRun に記録する。
 */
export async function POST(req: NextRequest) {
  if (!secretOk(req.headers.get("x-cron-secret"))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const today = todayJst();
  const snap = await adminDb().collection("companies").select().get();
  const summary: Record<string, Record<string, string>> = {};
  for (const d of snap.docs) {
    try {
      const r = await runDailyJobs(d.id, today);
      summary[d.id] = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.status]));
    } catch (e) {
      console.error("[jobs.run]", d.id, e instanceof Error ? e.message : String(e));
      summary[d.id] = { error: "failed" };
    }
  }
  return NextResponse.json({ today, companies: snap.size, summary });
}
