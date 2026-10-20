import Link from "next/link";
import { requireStaffPage } from "@/lib/server/session";
import { col } from "@/lib/server/repo";
import { SP } from "@/lib/server/query";
import { markNotificationRead, markAllNotificationsRead } from "@/lib/server/actions/notifications";
import { PageHeader, Badge, StateMessage } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { formatDateTimeJst } from "@/lib/domain/dates";

export const metadata = { title: "通知" };

interface Notice { id: string; title: string; href: string; kind: string; read: boolean; createdAt: string }

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireStaffPage();
  const sp = await searchParams;
  const unreadOnly = sp.unread === "1";
  let items: Notice[] = [];
  let error = false;
  try {
    let q = col(ctx.companyId, "notifications").where("toUid", "==", ctx.uid);
    if (unreadOnly) q = q.where("read", "==", false);
    const snap = await q.orderBy("createdAt", "desc").limit(100).get();
    items = snap.docs.map((d) => ({ ...(d.data() as Notice), id: d.id }));
  } catch (e) {
    console.error("[notifications.list]", (e as Error).message);
    error = true;
  }
  const unread = items.filter((i) => !i.read).length;
  return (
    <>
      <PageHeader
        title="通知"
        sub="アプリ内通知（最新100件）。外部へのメール等の送信は行いません。"
        actions={
          <>
            <Link href={unreadOnly ? "/notifications" : "/notifications?unread=1"} className="btn btn-secondary">{unreadOnly ? "すべて表示" : "未読のみ表示"}</Link>
            <ActionButton action={markAllNotificationsRead} label="すべて既読にする" disabled={unread === 0} />
          </>
        }
      />
      <div className="card">
        {error ? (
          <StateMessage kind="error" message="通知を読み込めませんでした。時間をおいて再読み込みしてください。" />
        ) : items.length === 0 ? (
          <StateMessage kind={unreadOnly ? "no_results" : "empty"} message={unreadOnly ? "未読の通知はありません" : "通知はありません"} />
        ) : (
          <ul className="divide-y divide-line">
            {items.map((n) => (
              <li key={n.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${n.read ? "" : "bg-primary-soft/40"}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {n.read ? <Badge>既読</Badge> : <Badge tone="info">未読</Badge>}
                    <span className="text-sm text-muted">{formatDateTimeJst(n.createdAt)}</span>
                  </div>
                  <p className={`mt-0.5 break-words ${n.read ? "" : "font-semibold"}`}>{n.title}</p>
                </div>
                <div className="flex gap-2">
                  <ActionButton action={markNotificationRead} args={{ id: n.id, open: true }} label="開く" size="sm" variant="primary" />
                  {!n.read && <ActionButton action={markNotificationRead} args={{ id: n.id }} label="既読にする" size="sm" />}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
