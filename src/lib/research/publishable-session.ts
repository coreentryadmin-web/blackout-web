/**
 * THE PUBLISH BOUNDARY — which market sessions may appear on a PUBLIC, unauthenticated page.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────────────────────
 *
 * Paying for API access buys the right to USE vendor data. It does not, on its own, buy the right
 * to REDISTRIBUTE it. Options and index data reach us through Polygon but are owned upstream by
 * OPRA and the index licensors, and those licensors withhold redistribution by default — Polygon
 * cannot grant us a right its own supplier retained. The practical consequence is that the same
 * number carries different exposure depending on WHERE it is shown and HOW OLD it is:
 *
 *      behind auth + real-time   → what members pay for, covered by our data agreements
 *      public   + real-time      → redistribution of near-live vendor data (the risk)
 *      public   + prior sessions → historical, delayed, and here further DERIVED
 *
 * The research pages are deliberately built in the third row. This module is the wall between
 * rows two and three, and it is code rather than a documented convention because a convention is
 * exactly what fails silently: a future page adds "and here's where it is right now", nothing
 * objects, and a public URL starts serving live vendor values.
 *
 * ── HOW IT ENFORCES ──────────────────────────────────────────────────────────────────────────
 *
 * `PublishableSession` is a BRANDED string. There is no way to construct one except through
 * `publishableSessions()` / `asPublishableSession()`, both of which apply the cutoff. Every
 * research loader takes `PublishableSession` rather than `string`, so a raw `todayEt()` cannot be
 * passed into a public data path — tsc rejects it at the call site. The rule and the type are the
 * same object, which is the only arrangement that survives someone editing this in six months.
 *
 * ── THE CUTOFF, AND WHY IT IS A WHOLE DAY ────────────────────────────────────────────────────
 *
 * The newest publishable session is the most recent trading day STRICTLY BEFORE the current ET
 * calendar date. Not "today if the close has passed" — a whole day earlier, unconditionally.
 *
 * That is deliberately more conservative than it needs to be, for two reasons. First, "has the
 * close passed" is a clock comparison, and a clock comparison is one timezone bug away from
 * publishing a session that is still open; the date comparison has no such failure mode. Second,
 * a same-day page would be re-rendered repeatedly through the session as data arrived, which is
 * behaviourally a live feed no matter what the cache header says. A day boundary makes the page
 * a genuine archive: it is written once, from a session that can no longer change.
 *
 * The cost is that the freshest public page trails by one session. For content whose value is our
 * classification of a 90-day pattern, that costs essentially nothing.
 */

import { isTradingDayEt, previousTradingDayEt, todayEt } from "@/features/nighthawk/lib/session";

declare const PUBLISHABLE: unique symbol;

/**
 * A `YYYY-MM-DD` session date that has passed the publish cutoff.
 *
 * Branded so it cannot be forged from a plain string. Public research loaders accept only this
 * type; `todayEt()` returns a bare `string` and therefore will not type-check as a substitute.
 */
export type PublishableSession = string & { readonly [PUBLISHABLE]: true };

/** `YYYY-MM-DD`. Anything else is not a session date and is rejected rather than coerced. */
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The newest session date a public page may reference.
 *
 * `todayEt()` is the ET calendar date; stepping back from it yields the most recent trading day
 * strictly before today, whether or not today is itself a trading day. On a Sunday that is
 * Friday; on a Monday it is Friday; on a Wednesday it is Tuesday.
 */
export function newestPublishableSession(today: string = todayEt()): PublishableSession {
  return previousTradingDayEt(today) as PublishableSession;
}

/**
 * Narrow a raw session date to a publishable one, or `null` when it is too recent.
 *
 * Returns `null` rather than throwing: a caller handed today's date is not in an exceptional
 * state, it is in the ordinary state of having nothing publishable to show yet, and that renders
 * as an honest absence on the page. Throwing would turn it into a 500.
 */
export function asPublishableSession(
  ymd: unknown,
  today: string = todayEt()
): PublishableSession | null {
  if (typeof ymd !== "string" || !YMD.test(ymd)) return null;
  if (!isTradingDayEt(ymd)) return null;
  // String comparison is correct ordering for zero-padded ISO dates, and avoids constructing a
  // Date — which is where every timezone bug in this area has come from.
  if (ymd > newestPublishableSession(today)) return null;
  return ymd as PublishableSession;
}

/**
 * The `count` most recent publishable trading sessions, newest first.
 *
 * Walks the real NYSE calendar (weekends and holidays skipped by `previousTradingDayEt`), so a
 * "60 sessions" window is 60 sessions of data rather than 60 calendar days with gaps in it.
 */
export function publishableSessions(
  count: number,
  today: string = todayEt()
): PublishableSession[] {
  if (!Number.isFinite(count) || count <= 0) return [];
  const out: PublishableSession[] = [];
  let cursor = newestPublishableSession(today);
  for (let i = 0; i < Math.floor(count); i += 1) {
    out.push(cursor);
    cursor = previousTradingDayEt(cursor) as PublishableSession;
  }
  return out;
}

/**
 * Guard for data that arrived from somewhere else (a DB row, a cached payload).
 *
 * Rows are fetched with a session filter, but the filter and the render are different places and
 * only one of them is this module. Re-checking at the boundary means a widened query cannot leak
 * a live session into a public page without also editing this call.
 */
export function retainPublishable<T extends { session: string }>(
  rows: readonly T[],
  today: string = todayEt()
): T[] {
  const cutoff = newestPublishableSession(today);
  return rows.filter((r) => typeof r.session === "string" && YMD.test(r.session) && r.session <= cutoff);
}
