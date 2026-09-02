import { etSessionDate } from "@/lib/largo/temporal/bar-session-date";
import type { VectorBoardCalendarBucket } from "@/features/nighthawk/lib/vector-board-table-utils";

/** Recent NY session dates (weekdays only) for the Legacy edition calendar strip. */
export function legacyEditionSessionDates(count = 14, nowMs = Date.now()): string[] {
  const out: string[] = [];
  let cursor = nowMs;
  let guard = 0;
  while (out.length < count && guard < count * 4) {
    guard += 1;
    const session = etSessionDate(cursor);
    if (session) {
      const dow = new Date(`${session}T12:00:00Z`).getUTCDay();
      if (dow !== 0 && dow !== 6 && !out.includes(session)) {
        out.push(session);
      }
    }
    cursor -= 24 * 60 * 60 * 1000;
  }
  return out.reverse();
}

/** Calendar buckets for edition browsing — PnL fields are placeholders until record overlay lands. */
export function legacyEditionCalendarBuckets(
  dates: string[],
  playCountByDate?: Map<string, number>
): VectorBoardCalendarBucket[] {
  return dates.map((session_date) => {
    const n = playCountByDate?.get(session_date) ?? 0;
    return {
      session_date,
      tone: "flat",
      net_premium_pct: 0,
      n,
      winners: 0,
      closed: 0,
    };
  });
}
