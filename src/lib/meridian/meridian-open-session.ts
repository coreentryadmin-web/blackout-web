import { isTradingDayEt } from "@/features/nighthawk/lib/session";

/**
 * The ET date of a session that is CURRENTLY OPEN, or null when the market is shut.
 *
 * Exists so `reactionForPrint` can tell a settled reaction from one still being formed. Pure
 * apart from the clock, and the clock is a parameter, so it is testable without freezing time.
 *
 * WHY THIS MATTERS. Polygon serves a daily aggregate for the CURRENT session while it is still
 * running, and that bar's `c` is simply the last trade so far. Nothing about its shape says so.
 * Read at 09:46 ET on 2026-08-21 — sixteen minutes into the session — today's BMO prints came
 * back from production as:
 *
 *   BEKE  reaction_pct -4.74  reaction_measure "session_open_to_close"
 *   BJ    reaction_pct  1.74  reaction_measure "session_open_to_close"
 *   BKE   reaction_pct  2.21  reaction_measure "session_open_to_close"
 *
 * BJ and BKE matched Polygon's partial bar to the decimal. BEKE moved -4.74 → -4.24 between two
 * reads a minute apart. A six-hour-unfinished number was presented exactly like a print from
 * three quarters ago, under a label asserting a close that had not happened.
 *
 * BOUNDS. RTH is 09:30–16:00 ET. The lower bound is the open because before it there is no
 * session move to speak of; the upper bound is the close because at 16:00 the bar is final. A
 * non-trading day — weekend or holiday — has no open session at all, which is why this uses
 * `isTradingDayEt` rather than a weekday test.
 */
const OPEN_MIN = 9 * 60 + 30;
const CLOSE_MIN = 16 * 60;

export function openSessionYmd(now: Date = new Date()): string | null {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
  if (!isTradingDayEt(ymd)) return null;
  const hm = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  const [h, m] = hm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const mins = h * 60 + m;
  // At exactly 16:00 the session is DONE, so the bar is final — strict less-than on the close.
  return mins >= OPEN_MIN && mins < CLOSE_MIN ? ymd : null;
}
