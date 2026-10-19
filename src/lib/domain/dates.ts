// B01: 業務日付は日本の暦日 "YYYY-MM-DD" 文字列で扱う（時刻・タイムゾーンを持たない）。
// 操作日時は ISO 文字列(UTC)で保存し、表示時に Asia/Tokyo へ変換する。

export type BizDate = string; // "YYYY-MM-DD"

const RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseBizDate(d: BizDate): { y: number; m: number; day: number } {
  const m = RE.exec(d);
  if (!m) throw new Error(`日付形式が不正です: ${d}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const day = Number(m[3]);
  if (mo < 1 || mo > 12 || day < 1 || day > daysInMonth(y, mo)) {
    throw new Error(`存在しない日付です: ${d}`);
  }
  return { y, m: mo, day };
}

export function isValidBizDate(d: unknown): d is BizDate {
  if (typeof d !== "string") return false;
  try {
    parseBizDate(d);
    return true;
  } catch {
    return false;
  }
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

export function fmt(y: number, m: number, d: number): BizDate {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** 通日（1970-01-01 = 0） */
export function toDayNumber(d: BizDate): number {
  const { y, m, day } = parseBizDate(d);
  return Math.round(Date.UTC(y, m - 1, day) / 86400000);
}

export function fromDayNumber(n: number): BizDate {
  const dt = new Date(n * 86400000);
  return fmt(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addDays(d: BizDate, n: number): BizDate {
  return fromDayNumber(toDayNumber(d) + n);
}

export function addMonths(d: BizDate, n: number): BizDate {
  const { y, m, day } = parseBizDate(d);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return fmt(ny, nm, Math.min(day, daysInMonth(ny, nm)));
}

export function compare(a: BizDate, b: BizDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 両端を含む日数 */
export function inclusiveDays(start: BizDate, end: BizDate): number {
  return toDayNumber(end) - toDayNumber(start) + 1;
}

/** 両端を含む期間同士の重なり（B01: 開始日・終了日は両日を含む）。end=null は無期限 */
export function periodsOverlap(
  a: { start: BizDate; end: BizDate | null },
  b: { start: BizDate; end: BizDate | null },
): boolean {
  const aEnd = a.end ?? "9999-12-31";
  const bEnd = b.end ?? "9999-12-31";
  return a.start <= bEnd && b.start <= aEnd;
}

export function monthStart(ym: string): BizDate {
  return `${ym}-01`;
}

export function monthEnd(ym: string): BizDate {
  const [y, m] = ym.split("-").map(Number);
  return fmt(y, m, daysInMonth(y, m));
}

/** 今日の日本日付 */
export function todayJst(now: Date = new Date()): BizDate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return parts; // en-CA → YYYY-MM-DD
}

export function formatDateTimeJst(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** B24: 期限 = 基準日から n 日前 / n か月前。休日調整は前営業日（土日のみ）へ寄せる。 */
export function deadlineFrom(
  base: BizDate,
  rule: { unit: "days" | "months"; amount: number; holidayAdjust: "none" | "previous_weekday" },
): BizDate {
  let d = rule.unit === "days" ? addDays(base, -rule.amount) : addMonths(base, -rule.amount);
  if (rule.holidayAdjust === "previous_weekday") {
    for (;;) {
      const dow = new Date(toDayNumber(d) * 86400000).getUTCDay();
      if (dow !== 0 && dow !== 6) break;
      d = addDays(d, -1);
    }
  }
  return d;
}
