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
    });
  } catch {
    return { available: false, upcoming_7d: [], stats: null };
  }
}
