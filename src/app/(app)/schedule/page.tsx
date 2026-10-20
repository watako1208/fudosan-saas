import Link from "next/link";
import { requireStaffPage, currentStoreId } from "@/lib/server/session";
import { findDocs, Where } from "@/lib/server/repo";
import { SP } from "@/lib/server/query";
import { staffNameMap, staffOptions } from "@/lib/server/lookups";
import { C, EventDoc } from "@/lib/types";
import { PageHeader, StateMessage } from "@/components/ui";
import { TimeGrid, MonthGrid, weekDays } from "@/components/schedule/Calendar";
import { isValidBizDate, todayJst } from "@/lib/domain/dates";
import { addDaysStr, addMonthsStr, weekStartOf, monthGrid, jstDayStartIso } from "@/lib/domain/deals";

export const metadata = { title: "予定" };

const g = (sp: SP, k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");

export default async function SchedulePage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireStaffPage("schedule.read");
  const sp = await searchParams;
  const today = todayJst();
  const view = (["day", "week", "month"].includes(g(sp, "view")) ? g(sp, "view") : "week") as "day" | "week" | "month";
  const date = isValidBizDate(g(sp, "date")) ? g(sp, "date") : today;
  const assignee = g(sp, "assigneeUid");

  let rangeStart: string;
  let rangeEnd: string; // 排他
  let prev: string;
  let next: string;
  if (view === "day") {
    rangeStart = date;
    rangeEnd = addDaysStr(date, 1);
    prev = addDaysStr(date, -1);
    next = addDaysStr(date, 1);
  } else if (view === "week") {
    rangeStart = weekStartOf(date);
    rangeEnd = addDaysStr(rangeStart, 7);
    prev = addDaysStr(date, -7);
    next = addDaysStr(date, 7);
  } else {
    const cells = monthGrid(date);
    rangeStart = cells[0];
    rangeEnd = addDaysStr(cells[41], 1);
    prev = addMonthsStr(date, -1);
    next = addMonthsStr(date, 1);
  }

  const where: Where[] = [
    // 前日に始まり当日にかかる予定も表示するため1日前から取得
    ["start", ">=", jstDayStartIso(addDaysStr(rangeStart, -1))],
    ["start", "<", jstDayStartIso(rangeEnd)],
  ];
  if (assignee) where.unshift(["assigneeUid", "==", assignee]);
  const store = await currentStoreId(ctx);
  let events: EventDoc[] = [];
  let error = false;
  try {
    events = (await findDocs<EventDoc>(ctx, C.events, where, 1000)).filter(
      (e) => !e.archived && (!store || !e.storeId || e.storeId === store) && e.end > jstDayStartIso(rangeStart),
    );
  } catch (e) {
    console.error("[schedule.list]", (e as Error).message);
    error = true;
  }
  const names = await staffNameMap(ctx);
  const staff = await staffOptions(ctx);
  const q = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ view, date, ...(assignee ? { assigneeUid: assignee } : {}), ...patch });
    return `/schedule?${p.toString()}`;
  };
  const title =
    view === "day" ? `${date.replace(/-/g, "/")}` : view === "week" ? `${rangeStart.replace(/-/g, "/")} 〜 ${addDaysStr(rangeStart, 6).slice(5).replace("-", "/")}` : `${date.slice(0, 4)}年${Number(date.slice(5, 7))}月`;

  return (
    <>
      <PageHeader
        title="予定・内見"
        sub="日・週・月で表示します。担当者の時間重複は登録時に警告します（外部カレンダーとは同期しません）"
        actions={
          <>
            <Link href="/schedule/tasks" className="btn btn-secondary">タスク一覧</Link>
            {ctx.caps.has("schedule.write") && <Link href={`/schedule/new?date=${date}`} className="btn btn-primary">＋ 予定を登録</Link>}
          </>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-line bg-surface p-0.5" role="group" aria-label="表示切替">
          {(["day", "week", "month"] as const).map((v) => (
            <Link key={v} href={q({ view: v })} className={`btn btn-sm ${view === v ? "btn-primary" : "btn-ghost"}`} aria-current={view === v ? "page" : undefined}>
              {{ day: "日", week: "週", month: "月" }[v]}
            </Link>
          ))}
        </div>
        <Link href={q({ date: prev })} className="btn btn-secondary btn-sm" aria-label="前へ">← 前</Link>
        <Link href={q({ date: today })} className="btn btn-secondary btn-sm">今日</Link>
        <Link href={q({ date: next })} className="btn btn-secondary btn-sm" aria-label="次へ">次 →</Link>
        <span className="text-lg font-semibold">{title}</span>
        <form method="get" action="/schedule" className="ml-auto flex items-center gap-2">
          <input type="hidden" name="view" value={view} />
          <input type="hidden" name="date" value={date} />
          <label className="text-sm">
            <span className="sr-only">担当者</span>
            <select name="assigneeUid" defaultValue={assignee} className="input !w-auto">
              <option value="">担当: すべて</option>
              {staff.map((s) => <option key={s.value} value={s.value}>担当: {s.label}</option>)}
            </select>
          </label>
          <button className="btn btn-secondary btn-sm">絞込み</button>
          {assignee !== ctx.uid && <Link href={q({ assigneeUid: ctx.uid })} className="btn btn-ghost btn-sm">自分の予定</Link>}
        </form>
      </div>
      {error ? (
        <div className="card"><StateMessage kind="error" message="予定を読み込めませんでした。時間をおいて再読み込みしてください。" /></div>
      ) : (
        <>
          {view === "month" ? (
            <MonthGrid date={date} events={events} today={today} />
          ) : (
            <TimeGrid days={view === "day" ? [date] : weekDays(rangeStart)} events={events} names={names} today={today} />
          )}
          {events.length === 0 && <p className="mt-2 text-sm text-muted">この期間の予定はありません</p>}
        </>
      )}
    </>
  );
}
