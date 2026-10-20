import { ActionButton } from "@/components/ActionButton";
import { Badge, StateMessage } from "@/components/ui";
import { archiveActivity } from "@/lib/server/actions/deals";
import { ACTIVITY_CHANNEL, ACTIVITY_DIRECTION } from "@/lib/labels-deals";
import { lbl } from "@/lib/labels";
import { formatDateTimeJst } from "@/lib/domain/dates";
import type { Activity } from "@/lib/types";

/** 対応履歴（時系列・新しい順） */
export function ActivityList({ items, names, canWrite, uid }: { items: Activity[]; names: Map<string, string>; canWrite: boolean; uid: string }) {
  const list = items.filter((a) => !a.archived).sort((a, b) => (a.at < b.at ? 1 : -1));
  if (list.length === 0) return <div className="card"><StateMessage kind="empty" message="対応記録はまだありません" /></div>;
  return (
    <ol className="card divide-y divide-line">
      {list.map((a) => (
        <li key={a.id} className="px-4 py-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">{formatDateTimeJst(a.at)}</span>
            <Badge>{lbl(ACTIVITY_CHANNEL, a.channel)}</Badge>
            {a.direction !== "none" && <span className="text-muted">{lbl(ACTIVITY_DIRECTION, a.direction)}</span>}
            <span className="text-muted">記録: {names.get(a.byUid) ?? "—"}</span>
            {canWrite && a.byUid === uid && (
              <span className="ml-auto">
                <ActionButton action={archiveActivity} args={{ id: a.id }} label="取消" size="sm" variant="ghost" confirm="この対応記録を取り消しますか？（操作記録は残ります）" />
              </span>
            )}
          </div>
          <p className="mt-1 font-medium break-words">{a.summary}</p>
          {a.body && <p className="mt-1 text-sm whitespace-pre-wrap break-words">{a.body}</p>}
        </li>
      ))}
    </ol>
  );
}
