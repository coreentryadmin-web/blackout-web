import "server-only";

import { loadMeridianTimelineResponse } from "@/lib/meridian/meridian-snapshot";
import { roundFloats } from "@/lib/round-floats";

/** Compact Meridian timeline for Largo social / catalyst asks. */
export async function meridianTimelineForLargo(daysAhead = 14) {
  try {
    const payload = await loadMeridianTimelineResponse(daysAhead);
    const upcoming = payload.items
      .filter((i) => i.days_until >= 0 && i.days_until <= 7)
      .slice(0, 12)
      .map((i) => ({
        id: i.id,
        kind: i.kind,
        title: i.title,
        ticker: i.ticker ?? null,
        date: i.date,
        days_until: i.days_until,
        impact: i.impact,
      }));
    return roundFloats({
      available: true,
      as_of: payload.as_of,
      stats: payload.stats,
      board_tickers: payload.board_tickers?.slice(0, 20) ?? [],
      upcoming_7d: upcoming,
      // BUG FIX (2026-11-08, Ask Largo standing mandate): forwarded from
      // `loadMeridianTimelineResponse`'s `earnings_calendar_entitled` — see
      // `play-brief-meridian.ts`'s identical fix (`SwingMeridianCatalystSlice.calendar_entitled`)
      // for the full root-cause trace of this bug class. `available: true` above only means this
      // function's own try block didn't throw; it says nothing about whether the market-wide
      // Benzinga earnings-calendar fetch feeding `upcoming_7d`'s earnings-kind rows was itself
      // entitled. Before this fix, a refused/errored calendar fetch (live, 2026-11-07: the
      // Benzinga entitlement 403) still reported `available: true` with earnings rows silently
      // absent from `upcoming_7d` — indistinguishable from a genuinely quiet week.
      calendar_entitled: payload.earnings_calendar_entitled,
    });
  } catch {
    // A failed read is not a quiet calendar — upcoming_7d must stay null, not [], so a model
    // never reads "no upcoming events" from a read that never happened. Same class as the
    // absence-scan's other fixed sites (see docs/audit/FINDINGS.md 2026-08-21).
    // `calendar_entitled: null` (not omitted) keeps this branch's shape structurally consistent
    // with the success branch above, so a caller narrowing on `meridian?.available` can still
    // read `calendar_entitled` off either branch without a second cast — `available: false`
    // already covers "this whole read failed," so null here (rather than another boolean) avoids
    // implying a real entitlement answer exists when the read never got that far.
    return { available: false, upcoming_7d: null, stats: null, calendar_entitled: null };
  }
}
