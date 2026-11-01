/**
 * Format a bare `YYYY-MM-DD` calendar date for the admin "Per-play history" audit trail
 * (PlayHistoryTable.tsx) — `session_date` (spx_play_outcomes) and `edition_for`
 * (nighthawk_play_outcomes) are both Postgres `DATE` columns, serialized to the wire as a
 * plain `YYYY-MM-DD` string by `isoDateString()` (db.ts) before `/api/track-record/plays`
 * returns them.
 *
 * BUG THIS GUARDS (root cause): `new Date("2026-01-15")` — a date-ONLY ISO string, no time
 * component — is parsed as UTC MIDNIGHT per the ECMA-262 "Date Time String Format" spec. The
 * previous `fmtDate()` in PlayHistoryTable.tsx fed that straight into
 * `Date.prototype.toLocaleDateString`, which renders in the VIEWER's LOCAL timezone. For any
 * timezone BEHIND UTC — all of the US, where this admin panel is always opened from, on a
 * product that is itself entirely ET-anchored — that rolls the instant back across midnight
 * into the PREVIOUS calendar day. A play logged against trading day 2026-01-15 rendered as
 * "Jan 14, '26" to every US-based admin who ever expanded this table.
 *
 * Verified live (Node, `TZ=America/New_York`):
 *   new Date("2026-01-15").toLocaleDateString(...)              -> "Jan 14, 26"  (WRONG)
 *   new Date("2026-01-15T12:00:00").toLocaleDateString(...)     -> "Jan 15, 26"  (correct)
 *
 * FIX: anchor the parse at LOCAL NOON ("T12:00:00", no "Z" — i.e. noon in the VIEWER's own
 * timezone, not UTC noon) before formatting. Noon gives ±12h of slack on both sides, which
 * comfortably covers every real-world UTC offset (-12..+14), so the rendered calendar date
 * always matches the DB's calendar date regardless of the viewer's timezone. This is the same
 * pattern already used at ~25 other call sites across this codebase for exactly this reason
 * (e.g. features/nighthawk/lib/session.ts, deterministic-edition.ts,
 * VectorBoardCalendar.tsx) — this file was the one holdout that still parsed a bare date
 * string directly.
 */
export function formatPlayHistoryDate(raw: string | null): string {
  if (!raw) return "—";
  const ymd = /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null;
  const d = new Date(ymd ? `${ymd}T12:00:00` : raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}
