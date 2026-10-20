import Link from "next/link";
import { lbl } from "@/lib/labels";
import { EVENT_TYPE } from "@/lib/labels-deals";
import { assignLanes, jstDateOf, jstMinutesOfDay, jstTime, monthGrid, addDaysStr, dow } from "@/lib/domain/deals";
import type { EventDoc } from "@/lib/types";

const DOW = ["日", "月", "火", "水", "木", "金", "土"];
const START_H = 6;
const END_H = 24;
const HOUR_PX = 48;

type Ev = Pick<EventDoc, "id" | "title" | "type" | "start" | "end" | "assigneeUid" | "done" | "travelMinutes" | "place">;

function TypeTag({ ev }: { ev: Ev }) {
  return (
    <span className="mr-1 rounded border border-primary/30 bg-surface px-1 text-[10px] font-semibold text-primary">
      {lbl(EVENT_TYPE, ev.type)}
    </span>
  );
}

/** 日・週表示の1日分の列（重なる予定は横に並べる。移動時間は前後に斜線で表示） */
function DayColumn({ date, events, names }: { date: string; events: Ev[]; names: Map<string, string> }) {
  const lanes = assignLanes(events);
  const total = (END_H - START_H) * HOUR_PX;
  const pos = (min: number) => Math.max(0, Math.min(total, ((min - START_H * 60) / 60) * HOUR_PX));
  return (
    <div className="relative border-l border-line" style={{ height: total }} aria-label={`${date}の予定`}>
      {Array.from({ length: END_H - START_H }, (_, i) => (
        <div key={i} className="absolute inset-x-0 border-t border-line/70" style={{ top: i * HOUR_PX }} aria-hidden />
      ))}
      {lanes.map(({ ev, lane, lanes: n }) => {
        const sDate = jstDateOf(ev.start);
        const eDate = jstDateOf(ev.end);
        const sMin = sDate < date ? 0 : jstMinutesOfDay(ev.start);
        const eMin = eDate > date ? 24 * 60 : jstMinutesOfDay(ev.end);
        const top = pos(sMin);
        const height = Math.max(22, pos(eMin) - top);
        const travel = ev.travelMinutes ? (ev.travelMinutes / 60) * HOUR_PX : 0;
        const left = `calc(${(lane / n) * 100}% + 2px)`;
        const width = `calc(${100 / n}% - 4px)`;
        return (
          <div key={ev.id}>
            {travel > 0 && (
              <>
                <div className="absolute rounded-sm bg-[repeating-linear-gradient(45deg,#e2e5ea,#e2e5ea_3px,transparent_3px,transparent_6px)]" style={{ top: Math.max(0, top - travel), height: Math.min(travel, top), left, width }} title={`移動 ${ev.travelMinutes}分`} aria-hidden />
                <div className="absolute rounded-sm bg-[repeating-linear-gradient(45deg,#e2e5ea,#e2e5ea_3px,transparent_3px,transparent_6px)]" style={{ top: top + height, height: travel, left, width }} aria-hidden />
              </>
            )}
            <Link
              href={`/schedule/${ev.id}`}
              className={`absolute overflow-hidden rounded-md border px-1.5 py-0.5 text-xs leading-tight shadow-sm ${ev.done ? "border-line bg-[#eef0f3] text-muted" : "border-primary/40 bg-primary-soft text-ink hover:bg-primary-soft/70"}`}
              style={{ top, height, left, width }}
            >
              <span className="block font-semibold">{jstTime(ev.start)}〜{jstTime(ev.end)}{ev.done && "（実施済み）"}</span>
              <span className="block break-words"><TypeTag ev={ev} />{ev.title}</span>
              {ev.assigneeUid && <span className="block text-muted">{names.get(ev.assigneeUid) ?? ""}</span>}
              {ev.travelMinutes ? <span className="block text-muted">移動 前後{ev.travelMinutes}分</span> : null}
            </Link>
          </div>
        );
      })}
    </div>
  );
}

function eventsOn(events: Ev[], date: string) {
  return events.filter((e) => jstDateOf(e.start) <= date && jstDateOf(e.end) >= date && !(jstDateOf(e.end) === date && jstMinutesOfDay(e.end) === 0 && jstDateOf(e.start) !== date));
}

export function TimeGrid({ days, events, names, today }: { days: string[]; events: Ev[]; names: Map<string, string>; today: string }) {
  return (
    <div className="card overflow-x-auto">
      <div className="min-w-[640px]" style={{ display: "grid", gridTemplateColumns: `48px repeat(${days.length}, minmax(${days.length > 1 ? 90 : 200}px, 1fr))` }}>
        <div className="sticky top-0 z-10 border-b border-line bg-surface" />
        {days.map((d) => (
          <div key={d} className={`sticky top-0 z-10 border-b border-l border-line bg-surface px-2 py-1.5 text-center text-sm ${d === today ? "font-bold text-primary" : ""}`}>
            <Link href={`/schedule?view=day&date=${d}`} className="hover:underline">
              {Number(d.slice(5, 7))}/{Number(d.slice(8, 10))}（{DOW[dow(d)]}）
            </Link>
            {d === today && <span className="ml-1 text-xs">今日</span>}
          </div>
        ))}
        <div className="relative" style={{ height: (END_H - START_H) * HOUR_PX }}>
          {Array.from({ length: END_H - START_H }, (_, i) => (
            <div key={i} className="absolute right-1 -translate-y-1/2 text-[11px] text-muted" style={{ top: i * HOUR_PX }}>{i === 0 ? "" : `${START_H + i}:00`}</div>
          ))}
        </div>
        {days.map((d) => (
          <DayColumn key={d} date={d} events={eventsOn(events, d)} names={names} />
        ))}
      </div>
      {events.some((e) => jstMinutesOfDay(e.start) < START_H * 60 && jstDateOf(e.start) === jstDateOf(e.end)) && (
        <p className="px-3 py-2 text-xs text-muted">※ {START_H}時より前の予定は表の先頭に表示しています。</p>
      )}
    </div>
  );
}

export function MonthGrid({ date, events, today }: { date: string; events: Ev[]; today: string }) {
  const cells = monthGrid(date);
  const month = date.slice(0, 7);
  return (
    <div className="card overflow-x-auto">
      <div className="grid min-w-[640px] grid-cols-7">
        {[1, 2, 3, 4, 5, 6, 0].map((w) => (
          <div key={w} className="border-b border-line bg-[#f8f9fb] px-2 py-1 text-center text-xs font-semibold text-muted">{DOW[w]}</div>
        ))}
        {cells.map((d) => {
          const evs = eventsOn(events, d).sort((a, b) => (a.start < b.start ? -1 : 1));
          return (
            <div key={d} className={`min-h-24 border-b border-l border-line p-1 ${d.slice(0, 7) !== month ? "bg-bg/60 text-muted" : ""}`}>
              <Link href={`/schedule?view=day&date=${d}`} className={`text-xs hover:underline ${d === today ? "rounded bg-primary px-1 font-bold text-white" : ""}`}>
                {Number(d.slice(8, 10))}
              </Link>
              <ul className="mt-0.5 space-y-0.5">
                {evs.slice(0, 4).map((e) => (
                  <li key={e.id}>
                    <Link href={`/schedule/${e.id}`} className={`block truncate rounded px-1 text-[11px] ${e.done ? "text-muted line-through" : "bg-primary-soft hover:underline"}`} title={e.title}>
                      {jstDateOf(e.start) === d ? jstTime(e.start) : "続"} {lbl(EVENT_TYPE, e.type)} {e.title}
                    </Link>
                  </li>
                ))}
                {evs.length > 4 && (
                  <li><Link href={`/schedule?view=day&date=${d}`} className="text-[11px] text-primary hover:underline">他 {evs.length - 4}件</Link></li>
                )}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function weekDays(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysStr(start, i));
}
