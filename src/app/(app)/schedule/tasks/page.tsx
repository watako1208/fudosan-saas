import Link from "next/link";
import { requireStaffPage, currentStoreId } from "@/lib/server/session";
import { listDocs, Where } from "@/lib/server/repo";
import { SP } from "@/lib/server/query";
import { staffNameMap, staffOptions } from "@/lib/server/lookups";
import { C, TaskDoc } from "@/lib/types";
import { DataTable } from "@/components/DataTable";
import { PageHeader, Badge } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { toggleTask } from "@/lib/server/actions/schedule";
import { taskEntityHref } from "@/components/schedule/TaskTable";
import { entityLabels } from "@/components/schedule/task-labels";
import { todayJst, formatDateTimeJst } from "@/lib/domain/dates";

export const metadata = { title: "タスク" };

const g = (sp: SP, k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
const STATES: Record<string, string> = { open: "未完了", overdue: "期限超過", done: "完了", all: "すべて" };

export default async function TasksPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireStaffPage("schedule.read");
  const sp = await searchParams;
  const today = todayJst();
  const state = STATES[g(sp, "state")] ? g(sp, "state") : "open";
  const assignee = g(sp, "assigneeUid");
  const where: Where[] = [];
  if (assignee) where.push(["assigneeUid", "==", assignee]);
  if (state === "open" || state === "overdue") where.push(["done", "==", false]);
  if (state === "done") where.push(["done", "==", true]);
  if (state === "overdue") where.push(["due", "<", today]);
  const store = await currentStoreId(ctx);
  if (store) where.push(["storeId", "==", store]);
  let page;
  let error: string | null = null;
  try {
    page = await listDocs<TaskDoc>(ctx, C.tasks, {
      where,
      orderBy: "due",
      dir: state === "done" || state === "all" ? "desc" : "asc",
      page: Number(g(sp, "page") || 1) || 1,
      pageSize: Number(g(sp, "size") || 50) || 50,
    });
  } catch (e) {
    console.error("[tasks.list]", (e as Error).message);
    error = "タスクを読み込めませんでした。時間をおいて再読み込みしてください。";
  }
  const tasks = page?.items ?? [];
  const names = await staffNameMap(ctx);
  const labels = await entityLabels(ctx, tasks);
  const canWrite = ctx.caps.has("schedule.write");
  const staff = await staffOptions(ctx);

  return (
    <>
      <PageHeader
        title="タスク"
        sub="完了期限のある作業。期限を過ぎた未完了タスクは「期限超過」と表示します"
        actions={
          <>
            <Link href="/schedule" className="btn btn-secondary">予定（カレンダー）</Link>
            {canWrite && <Link href="/schedule/tasks/new" className="btn btn-primary">＋ タスクを追加</Link>}
          </>
        }
      />
      <form method="get" className="mb-3 flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="sr-only">状態</span>
          <select name="state" defaultValue={state} className="input !w-auto">
            {Object.entries(STATES).map(([k, v]) => <option key={k} value={k}>状態: {v}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="sr-only">担当</span>
          <select name="assigneeUid" defaultValue={assignee} className="input !w-auto">
            <option value="">担当: すべて</option>
            {staff.map((s) => <option key={s.value} value={s.value}>担当: {s.label}</option>)}
          </select>
        </label>
        <button className="btn btn-secondary">絞込み</button>
        <Link className="btn btn-ghost" href={`/schedule/tasks?state=open&assigneeUid=${ctx.uid}`}>自分の未完了</Link>
      </form>
      <DataTable
        tableId="tasks"
        csvName="タスク一覧"
        loadError={error}
        filtered={state !== "all" || !!assignee}
        total={page?.total ?? 0}
        page={page?.page ?? 1}
        pageSize={page?.pageSize ?? 50}
        emptyAction={canWrite && <Link href="/schedule/tasks/new" className="btn btn-primary">タスクを追加</Link>}
        columns={[
          { key: "status", label: "状態" },
          { key: "title", label: "件名", primary: true },
          { key: "due", label: "期限" },
          { key: "assignee", label: "担当" },
          { key: "entity", label: "関連" },
          { key: "doneInfo", label: "完了記録" },
          { key: "op", label: "操作" },
        ]}
        rows={tasks.map((t) => {
          const overdue = !t.done && t.due < today;
          const href = taskEntityHref(t);
          return {
            id: t.id,
            cells: {
              status: t.done ? <Badge tone="ok">完了</Badge> : overdue ? <Badge tone="danger">期限超過</Badge> : t.due === today ? <Badge tone="warn">本日期限</Badge> : <Badge>未完了</Badge>,
              title: <Link className="text-primary hover:underline" href={`/schedule/tasks/${t.id}`}>{t.title}</Link>,
              due: <span className={overdue ? "font-semibold text-danger" : ""}>{t.due}</span>,
              assignee: t.assigneeUid ? names.get(t.assigneeUid) ?? "—" : "未設定",
              entity: href ? <Link className="text-primary hover:underline" href={href}>{labels.get(`${t.entity}:${t.entityId}`) ?? "関連先を表示"}</Link> : "—",
              doneInfo: t.done ? `${names.get(t.doneBy ?? "") ?? "—"} ${formatDateTimeJst(t.doneAt)}` : "—",
              op: canWrite ? <ActionButton action={toggleTask} args={{ id: t.id }} label={t.done ? "未完了に戻す" : "完了にする"} size="sm" variant={t.done ? "ghost" : "secondary"} /> : null,
            },
            csv: {
              status: t.done ? "完了" : overdue ? "期限超過" : "未完了",
              title: t.title,
              due: t.due,
              assignee: t.assigneeUid ? names.get(t.assigneeUid) ?? "" : "",
              entity: labels.get(`${t.entity}:${t.entityId}`) ?? "",
              doneInfo: t.done ? `${names.get(t.doneBy ?? "") ?? ""} ${formatDateTimeJst(t.doneAt)}` : "",
              op: "",
            },
          };
        })}
      />
    </>
  );
}
