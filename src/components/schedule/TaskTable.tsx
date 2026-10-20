import Link from "next/link";
import { ActionButton } from "@/components/ActionButton";
import { Badge } from "@/components/ui";
import { toggleTask } from "@/lib/server/actions/schedule";
import { formatDateTimeJst } from "@/lib/domain/dates";
import type { TaskDoc } from "@/lib/types";

export function taskEntityHref(t: Pick<TaskDoc, "entity" | "entityId">): string | null {
  if (!t.entity || !t.entityId) return null;
  const base: Record<string, string> = { deal: "/deals/", party: "/parties/", property: "/properties/", contract: "/contracts/" };
  return base[t.entity] ? `${base[t.entity]}${t.entityId}` : null;
}

/** タスク一覧（期限超過は文字で「期限超過」を表示） */
export function TaskTable({
  tasks,
  names,
  today,
  canWrite,
  entityLabels,
  showEntity = true,
}: {
  tasks: TaskDoc[];
  names: Map<string, string>;
  today: string;
  canWrite: boolean;
  entityLabels?: Map<string, string>;
  showEntity?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr><th>状態</th><th>件名</th><th>期限</th><th>担当</th>{showEntity && <th>関連</th>}<th>完了記録</th><th></th></tr>
        </thead>
        <tbody>
          {tasks.map((t) => {
            const overdue = !t.done && t.due < today;
            const href = taskEntityHref(t);
            return (
              <tr key={t.id}>
                <td>{t.done ? <Badge tone="ok">完了</Badge> : overdue ? <Badge tone="danger">期限超過</Badge> : t.due === today ? <Badge tone="warn">本日期限</Badge> : <Badge>未完了</Badge>}</td>
                <td className="break-words">
                  <Link className="text-primary hover:underline" href={`/schedule/tasks/${t.id}`}>{t.title}</Link>
                </td>
                <td className={overdue ? "font-semibold text-danger" : ""}>{t.due}</td>
                <td>{t.assigneeUid ? names.get(t.assigneeUid) ?? "—" : "未設定"}</td>
                {showEntity && <td>{href ? <Link className="text-primary hover:underline" href={href}>{entityLabels?.get(`${t.entity}:${t.entityId}`) ?? "関連先を表示"}</Link> : "—"}</td>}
                <td className="text-xs">{t.done ? `${names.get(t.doneBy ?? "") ?? "—"} ${formatDateTimeJst(t.doneAt)}` : "—"}</td>
                <td>
                  {canWrite && (
                    <ActionButton action={toggleTask} args={{ id: t.id }} label={t.done ? "未完了に戻す" : "完了にする"} size="sm" variant={t.done ? "ghost" : "secondary"} />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
