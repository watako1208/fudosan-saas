import { requireStaffPage } from "@/lib/server/session";
import { getDoc } from "@/lib/server/repo";
import { staffOptions } from "@/lib/server/lookups";
import { saveTask } from "@/lib/server/actions/schedule";
import { C } from "@/lib/types";
import { PageHeader } from "@/components/ui";
import { TaskForm } from "@/components/schedule/TaskForm";
import { entityLabels } from "@/components/schedule/task-labels";
import { SP } from "@/lib/server/query";
import { addDays, todayJst } from "@/lib/domain/dates";

export const metadata = { title: "タスクの追加" };

export default async function NewTaskPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireStaffPage("schedule.write");
  const sp = await searchParams;
  const entity = typeof sp.entity === "string" && ["deal", "party", "property", "contract"].includes(sp.entity) ? sp.entity : null;
  const entityId = entity && typeof sp.entityId === "string" ? sp.entityId : null;
  let label: string | null = null;
  if (entity && entityId) {
    const colName = ({ deal: C.deals, party: C.parties, property: C.properties, contract: C.contracts } as Record<string, string>)[entity];
    if (await getDoc(ctx, colName, entityId)) {
      label = (await entityLabels(ctx, [{ entity, entityId }])).get(`${entity}:${entityId}`) ?? "関連先";
    }
  }
  const back = entity === "deal" && entityId ? `/deals/${entityId}?tab=tasks` : "";
  return (
    <>
      <PageHeader title="タスクの追加" />
      <TaskForm
        action={saveTask.bind(null, null)}
        initial={{ due: addDays(todayJst(), 3), assigneeUid: ctx.uid, _back: back }}
        entity={entity && entityId && label ? { entity, entityId, label } : null}
        cancelHref={back || "/schedule/tasks"}
        staff={await staffOptions(ctx)}
      />
    </>
  );
}
