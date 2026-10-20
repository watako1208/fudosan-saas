// 顧客・仲介案件・予定・所有者設定の純粋な業務ロジック（サーバー・画面の双方から利用）
import Decimal from "decimal.js";

// ───────────── 重複候補（S07: 自動統合はしない） ─────────────

/** 電話番号の正規化（数字のみ。6桁未満は比較対象外） */
export function normPhone(s: string | null | undefined): string | null {
  if (!s) return null;
  const d = s.normalize("NFKC").replace(/\D/g, "");
  return d.length >= 6 ? d : null;
}

export function normEmail(s: string | null | undefined): string | null {
  if (!s) return null;
  const e = s.normalize("NFKC").trim().toLowerCase();
  return e.includes("@") ? e : null;
}

/** 氏名＋読みの比較キー（空白・記号の違いを無視） */
export function nameKey(name: string | null | undefined, kana: string | null | undefined): string | null {
  const n = (name ?? "").normalize("NFKC").replace(/[\s　・･]/g, "").toLowerCase();
  const k = (kana ?? "").normalize("NFKC").replace(/[\s　・･]/g, "").toLowerCase();
  if (!n || !k) return null;
  return `${n}|${k}`;
}

// ───────────── 日時（入力は日本時間、保存は ISO） ─────────────

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** datetime-local の値（日本時間として解釈）→ ISO。例: "2026-10-20T10:00" → "2026-10-20T01:00:00.000Z" */
export function jstLocalToIso(local: string | null | undefined): string | null {
  if (!local) return null;
  const m = LOCAL_RE.exec(local.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const ms = Date.UTC(y, mo - 1, d, h - 9, mi);
  const back = new Date(ms + 9 * 3600000);
  if (back.getUTCDate() !== d || back.getUTCMonth() !== mo - 1) return null; // 存在しない日付
  return new Date(ms).toISOString();
}

/** ISO → datetime-local 用の日本時間文字列 "YYYY-MM-DDTHH:mm" */
export function isoToJstLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  return new Date(t + 9 * 3600000).toISOString().slice(0, 16);
}

/** ISO → 日本の日付 */
export function jstDateOf(iso: string): string {
  return isoToJstLocal(iso).slice(0, 10);
}

/** ISO → 日本時間の 0:00 からの経過分 */
export function jstMinutesOfDay(iso: string): number {
  const l = isoToJstLocal(iso);
  return Number(l.slice(11, 13)) * 60 + Number(l.slice(14, 16));
}

export function jstTime(iso: string): string {
  return isoToJstLocal(iso).slice(11, 16);
}

/** 日本の日付の 0:00 を ISO で */
export function jstDayStartIso(date: string): string {
  return jstLocalToIso(`${date}T00:00`)!;
}

// ───────────── 予定の重複（S11: 警告のみ。移動時間を前後に考慮） ─────────────

export interface TimedEvent {
  id?: string;
  title?: string;
  start: string; // ISO
  end: string; // ISO
  travelMinutes: number | null;
}

export interface OverlapWarning<T extends TimedEvent> {
  event: T;
  kind: "overlap" | "travel";
}

/**
 * 同じ担当者の予定との重複を検出する。
 * - overlap: 時間帯そのものが重なる
 * - travel: 重ならないが、どちらかの移動時間（前後）を確保できない
 */
export function findOverlaps<T extends TimedEvent>(target: TimedEvent, others: T[]): OverlapWarning<T>[] {
  const s1 = Date.parse(target.start);
  const e1 = Date.parse(target.end);
  const out: OverlapWarning<T>[] = [];
  for (const o of others) {
    if (target.id && o.id === target.id) continue;
    const s2 = Date.parse(o.start);
    const e2 = Date.parse(o.end);
    if (s1 < e2 && s2 < e1) {
      out.push({ event: o, kind: "overlap" });
      continue;
    }
    const buf = Math.max(target.travelMinutes ?? 0, o.travelMinutes ?? 0) * 60000;
    if (buf > 0 && s1 < e2 + buf && s2 < e1 + buf) out.push({ event: o, kind: "travel" });
  }
  return out;
}

/** 日表示・週表示で重なる予定を横に並べるためのレーン割当て */
export function assignLanes<T extends { start: string; end: string }>(events: T[]): { ev: T; lane: number; lanes: number }[] {
  const sorted = [...events].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const res: { ev: T; lane: number; lanes: number }[] = [];
  let group: { ev: T; lane: number; lanes: number }[] = [];
  let groupEnd = 0;
  let laneEnds: number[] = [];
  const flush = () => {
    const n = Math.max(1, laneEnds.length);
    group.forEach((g) => (g.lanes = n));
    res.push(...group);
    group = [];
    laneEnds = [];
  };
  for (const ev of sorted) {
    const s = Date.parse(ev.start);
    const e = Math.max(Date.parse(ev.end), s + 15 * 60000);
    if (group.length && s >= groupEnd) flush();
    let lane = laneEnds.findIndex((le) => le <= s);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(e);
    } else laneEnds[lane] = e;
    group.push({ ev, lane, lanes: 1 });
    groupEnd = Math.max(groupEnd, e);
  }
  flush();
  return res;
}

// ───────────── 所有者・送金配分（B20） ─────────────

/** 持分 "1/2" または "0.5" → Decimal。不正なら null */
export function parseShare(s: string | null | undefined): Decimal | null {
  const t = (s ?? "").normalize("NFKC").trim();
  if (!t) return null;
  try {
    const m = /^(\d+)\s*\/\s*(\d+)$/.exec(t);
    if (m) {
      if (Number(m[2]) === 0) return null;
      return new Decimal(m[1]).div(m[2]);
    }
    if (!/^\d+(\.\d+)?$/.test(t)) return null;
    return new Decimal(t);
  } catch {
    return null;
  }
}

export interface OwnershipRowForCheck {
  partyId: string;
  partyName?: string;
  share: string;
  remitRatio: string | null;
  remainderReceiver: boolean;
}

/** 有効な所有者の組合せを検証する（送金配分率の合計=1、端数受取は複数所有時に1名） */
export function validateOwnershipSet(rows: OwnershipRowForCheck[]): string[] {
  const e: string[] = [];
  const nm = (r: OwnershipRowForCheck) => r.partyName ?? "所有者";
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.partyId)) e.push(`${nm(r)} が重複して登録されています`);
    seen.add(r.partyId);
    const sh = parseShare(r.share);
    if (!sh || sh.lte(0) || sh.gt(1)) e.push(`${nm(r)} の持分が正しくありません（例: 1/2 または 0.5）`);
    if (r.remitRatio !== null) {
      const rr = parseShare(r.remitRatio);
      if (!rr || rr.lte(0) || rr.gt(1)) e.push(`${nm(r)} の送金配分率が正しくありません（例: 0.5）`);
    }
  }
  const withRatio = rows.filter((r) => r.remitRatio !== null);
  if (withRatio.length > 0) {
    if (withRatio.length !== rows.length) e.push("送金配分率を設定する場合は、有効なすべての所有者に設定してください");
    const sum = withRatio.reduce((s, r) => s.add(parseShare(r.remitRatio) ?? 0), new Decimal(0));
    if (!sum.eq(1)) e.push(`送金配分率の合計が100%になっていません（現在 ${sum.mul(100).toDecimalPlaces(4).toString()}%）`);
  }
  if (rows.length > 1) {
    const n = rows.filter((r) => r.remainderReceiver).length;
    if (n !== 1) e.push("複数の所有者がいる場合は、端数の配分先を1名だけ指定してください");
  }
  return e;
}

// ───────────── 役割の集約 ─────────────

/** 有効な役割レコード（アーカイブ・終了済みを除く）と手動設定の役割から Party.roles を作る */
export function aggregateRoles<R extends string>(
  manual: R[],
  records: { role: R; archived?: boolean; to: string | null }[],
  today: string,
): R[] {
  const set = new Set<R>(manual);
  for (const r of records) {
    if (r.archived) continue;
    if (r.to && r.to < today) continue;
    set.add(r.role);
  }
  return [...set].sort();
}

// ───────────── カレンダー ─────────────

function dn(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}
function fromDn(n: number): string {
  return new Date(n * 86400000).toISOString().slice(0, 10);
}
export function addDaysStr(date: string, n: number): string {
  return fromDn(dn(date) + n);
}
/** 曜日（0=日） */
export function dow(date: string): number {
  return new Date(dn(date) * 86400000).getUTCDay();
}
/** 週の開始（月曜） */
export function weekStartOf(date: string): string {
  return addDaysStr(date, -((dow(date) + 6) % 7));
}
/** 月表示のマス（月曜始まり、6週固定） */
export function monthGrid(date: string): string[] {
  const first = `${date.slice(0, 7)}-01`;
  const start = weekStartOf(first);
  return Array.from({ length: 42 }, (_, i) => addDaysStr(start, i));
}
export function addMonthsStr(date: string, n: number): string {
  const [y, m] = date.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}-01`;
}
