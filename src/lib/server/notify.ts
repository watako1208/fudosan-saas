import "server-only";
import { col, nowIso } from "./repo";
import { Ctx } from "./session";

/**
 * アプリ内通知。dedupeKey が同じ通知は宛先ごとに1件だけ作成する（同じ条件で大量重複させない）。
 * 業務トランザクションの確定後に呼び出す。既に存在する場合は何もしない（既読状態も維持）。
 */
export async function notify(
  ctx: Pick<Ctx, "companyId" | "uid">,
  n: { toUid: string | null | undefined; kind: string; title: string; href: string; dedupeKey: string },
): Promise<void> {
  if (!n.toUid) return;
  const id = `${n.dedupeKey}__${n.toUid}`.replace(/\//g, "_").slice(0, 400);
  try {
    await col(ctx.companyId, "notifications").doc(id).create({
      id,
      companyId: ctx.companyId,
      toUid: n.toUid,
      kind: n.kind,
      title: n.title,
      href: n.href,
      createdAt: nowIso(),
      createdBy: ctx.uid,
      read: false,
      archived: false,
    });
  } catch (e) {
    if ((e as { code?: number }).code !== 6) console.error("[notify]", (e as Error).message); // 6 = ALREADY_EXISTS
  }
}
