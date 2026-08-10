import type { LargoConversation } from "@/features/largo/conversation-history";

/**
 * RESEARCH SESSIONS — group the history list by day, with a real clock time per entry.
 *
 * WHY. The list was a flat run of threads labelled "2h ago", "5h ago", "yesterday". Relative time
 * is the right format for a notification and the wrong one for research: a member looking for
 * what they worked out this morning thinks "that was around ten", not "that was seven hours ago",
 * and a flat list gives them no way to see that four of those threads were one continuous piece
 * of work and the fifth was a different day entirely.
 *
 * Day headers plus a wall-clock stamp turn the same data into a workspace — the shape a desk
 * actually keeps notes in.
 *
 * ET, NOT LOCAL TIME. Sessions are anchored to the trading day. A member in London looking back at
 * "09:48" must see the market open, not their afternoon; grouping by local midnight would split a
 * single RTH session across two headers for anyone outside US hours.
 *
 * PURE AND TOTAL: no IO, no throw, clock injected so tests are deterministic.
 */

export type SessionGroup = {
  /** "TODAY", "YESTERDAY", or a date label like "MON 4 AUG". */
  label: string;
  /** ET day key (YYYY-MM-DD) — stable identity for the group, independent of the label. */
  key: string;
  items: Array<LargoConversation & { time: string }>;
};

const ET = "America/New_York";

/** YYYY-MM-DD in ET. */
export function etDayKey(ms: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ET,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** HH:MM in ET, 24h — the format a trading log is kept in. */
export function etClock(ms: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

function dayLabel(key: string, todayKey: string, yesterdayKey: string): string {
  if (key === todayKey) return "TODAY";
  if (key === yesterdayKey) return "YESTERDAY";
  // Parsed as UTC noon so the label can never slip a day through a timezone offset — the key is
  // already an ET calendar date and must be rendered as exactly that date.
  const d = new Date(`${key}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  })
    .format(d)
    .toUpperCase();
}

/**
 * Group conversations into day sections, newest first, each item stamped with its ET clock time.
 *
 * Ordering is explicit at BOTH levels — groups by day descending, items within a day by time
 * descending — because relying on the input already being sorted is how a "most recent" list
 * quietly stops being most-recent the moment a caller changes.
 */
export function groupConversationsByDay(
  conversations: readonly LargoConversation[],
  nowMs: number
): SessionGroup[] {
  const todayKey = etDayKey(nowMs);
  const yesterdayKey = etDayKey(nowMs - 24 * 60 * 60 * 1000);

  const byDay = new Map<string, SessionGroup>();
  for (const c of conversations) {
    if (!Number.isFinite(c.updatedAt)) continue; // a malformed row must not create a NaN header
    const key = etDayKey(c.updatedAt);
    let group = byDay.get(key);
    if (!group) {
      group = { key, label: dayLabel(key, todayKey, yesterdayKey), items: [] };
      byDay.set(key, group);
    }
    group.items.push({ ...c, time: etClock(c.updatedAt) });
  }

  const groups = [...byDay.values()].sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
  for (const g of groups) g.items.sort((a, b) => b.updatedAt - a.updatedAt);
  return groups;
}
