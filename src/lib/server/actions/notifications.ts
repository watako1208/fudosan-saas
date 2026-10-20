"use server";
import { adminDb } from "../firebase-admin";
import { getCtx, AuthError } from "../session";
import { run, str, ActionResult } from "../action";
import { col, NotFoundError } from "../repo";

async function me() {
  const ctx = await getCtx();
  if (!ctx) throw new AuthError("ログインが必要です", "unauthenticated");
  return ctx;
}

/** 通知を既読にする（本人宛てのみ） */
export async function markNotificationRead(input: Record<string, unknown>): Promise<ActionResult<{ redirect?: string } | null>> {
  return run(async () => {
    const ctx = await me();
    const id = str(input.id);
    if (!id || id.includes("/")) throw new NotFoundError();
    const r = col(ctx.companyId, "notifications").doc(id);
    const href = await adminDb().runTransaction(async (tx) => {
      const s = await tx.get(r);
      if (!s.exists || s.data()!.toUid !== ctx.uid || s.data()!.companyId !== ctx.companyId) throw new NotFoundError();
      if (!s.data()!.read) tx.update(r, { read: true, readAt: new Date().toISOString() });
      return s.data()!.href as string;
    });
    return input.open && typeof href === "string" && href.startsWith("/") ? { redirect: href } : null;
  });
}

export async function markAllNotificationsRead(): Promise<ActionResult<{ count: number }>> {
  return run(async () => {
    const ctx = await me();
    let count = 0;
    for (let i = 0; i < 10; i++) {
      const snap = await col(ctx.companyId, "notifications").where("toUid", "==", ctx.uid).where("read", "==", false).limit(400).get();
      if (snap.empty) break;
      const batch = adminDb().batch();
      const t = new Date().toISOString();
      snap.docs.forEach((d) => batch.update(d.ref, { read: true, readAt: t }));
      await batch.commit();
      count += snap.size;
      if (snap.size < 400) break;
    }
    return { count };
  });
}
