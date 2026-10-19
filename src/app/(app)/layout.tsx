import { requireStaffPage } from "@/lib/server/session";
import { NAV, ROLE_LABEL } from "@/lib/permissions";
import { col } from "@/lib/server/repo";
import { adminDb } from "@/lib/server/firebase-admin";
import { cookies } from "next/headers";
import { Shell } from "@/components/Shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireStaffPage();
  const nav = NAV.filter((n) => !n.cap || ctx.caps.has(n.cap)); // 権限のない項目は表示しない
  const [storesSnap, unreadSnap, companySnap] = await Promise.all([
    col(ctx.companyId, "stores").where("archived", "==", false).limit(100).get(),
    col(ctx.companyId, "notifications").where("toUid", "==", ctx.uid).where("read", "==", false).count().get(),
    adminDb().collection("companies").doc(ctx.companyId).get(),
  ]);
  const isAdmin = ctx.user.roles.includes("admin");
  const stores = storesSnap.docs
    .map((d) => ({ id: d.id, name: d.data().name as string }))
    .filter((s) => isAdmin || ctx.user.storeIds.includes(s.id));
  return (
    <Shell
      nav={nav.map(({ href, label, icon }) => ({ href, label, icon }))}
      companyName={(companySnap?.data()?.name as string) ?? ""}
      userName={ctx.user.displayName}
      roleLabel={ctx.user.roles.map((r) => ROLE_LABEL[r]).join("・")}
      stores={stores}
      unread={unreadSnap.data().count}
      currentStore={(await cookies()).get("store")?.value ?? ""}
    >
      {children}
    </Shell>
  );
}
