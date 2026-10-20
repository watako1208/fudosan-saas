import { notFound } from "next/navigation";
import { requireStaffPage, canAccessStore } from "@/lib/server/session";
import { getDoc } from "@/lib/server/repo";
import { staffOptions, staffName } from "@/lib/server/lookups";
import { saveTask, toggleTask, archiveTask } from "@/lib/server/actions/schedule";
import { C, TaskDoc } from "@/lib/types";
import { DetailHeader, Badge } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { TaskForm } from "@/components/schedule/TaskForm";
import { entityLabels } from "@/components/schedule/task-labels";
import { formatDateTimeJst, todayJst } from "@/lib/domain/dates";

export const metadata = { title: "タスク" };

export default async function TaskPage({ params }: { params: Promise<{ tid: string }> }) {
  const ctx = await requireStaffPage("schedule.read");
  const { tid } = await params;
  const t = await getDoc<TaskDoc>(ctx, C.tasks, tid);
  if (!t) notFound();
  const canEdit = ctx.caps.has("schedule.write") && canAccessStore(ctx, t.storeId);
  const overdue = !t.done && t.due < todayJst();
  const label = t.entity && t.entityId ? (await entityLabels(ctx, [t])).get(`${t.entity}:${t.entityId}`) ?? "関連先" : null;
  return (
    <>
      <DetailHeader
        back={{ href: "/schedule/tasks", label: "タスク一覧" }}
        title={t.title}
        badges={
          <>
            {t.done ? <Badge tone="ok">完了</Badge> : overdue ? <Badge tone="danger">期限超過</Badge> : <Badge>未完了</Badge>}
            {t.archived && <Badge>削除済み（アーカイブ）</Badge>}
          </>
        }
        meta={
          <>
            <span>期限: {t.due}</span>
            <span>担当: {await staffName(ctx, t.assigneeUid)}</span>
            {t.done && <span>完了: {await staffName(ctx, t.doneBy)} {formatDateTimeJst(t.doneAt)}</span>}
          </>
        }
        actions={
          canEdit && (
            <>
              <ActionButton action={toggleTask} args={{ id: tid }} label={t.done ? "未完了に戻す" : "完了にする"} variant="primary" />
              {!t.archived && <ActionButton action={archiveTask} args={{ id: tid }} label="削除" variant="danger" confirm="このタスクを削除しますか？（記録はアーカイブとして残ります）" redirectTo="/schedule/tasks" />}
            </>
          )
        }
      />
      {canEdit && (
        <TaskForm
          action={saveTask.bind(null, tid)}
          initial={{ ...JSON.parse(JSON.stringify(t)), _back: `/schedule/tasks/${tid}` }}
          version={t.version}
          entity={t.entity && t.entityId ? { entity: t.entity, entityId: t.entityId, label: label ?? "関連先" } : null}
          cancelHref="/schedule/tasks"
          staff={await staffOptions(ctx)}
        />
      )}
    </>
  );
}
