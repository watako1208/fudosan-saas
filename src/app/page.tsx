import { redirect } from "next/navigation";
import { getCtx } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export default async function Root() {
  const ctx = await getCtx();
  if (!ctx) redirect("/login");
  redirect(ctx.isStaff ? "/home" : "/portal");
}
