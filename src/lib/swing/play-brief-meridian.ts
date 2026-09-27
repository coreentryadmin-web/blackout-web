/**
 * Meridian catalyst slice for swing play brief — cached timeline, ticker-filtered.
 */
import { serverCache } from "@/lib/server-cache";
import {
  loadMeridianTimelineResponse,
  MERIDIAN_TIMELINE_TTL_MS,
} from "@/lib/meridian/meridian-snapshot";
import {
  MERIDIAN_LARGO_WINDOW_DAYS,
  shapeTimelineItems,
  type LargoTimelineItem,
} from "@/lib/largo/meridian-timeline-for-largo";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { etStamp } from "@/lib/largo/temporal/bar-session-date";
import { SWING_MERIDIAN_INDEX_TICKERS } from "./play-brief-meridian-peer-core";

export type SwingMeridianCatalystSlice = {
  as_of: string;
  items: LargoTimelineItem[];
  total_matched: number;
  unavailable?: boolean;
};

/** Index/proxy names that use market-wide Meridian catalyst slices — no per-name earnings peer cohort. */
export { SWING_MERIDIAN_INDEX_TICKERS };
const INDEX_TICKERS = SWING_MERIDIAN_INDEX_TICKERS;

export async function fetchMeridianForTicker(ticker: string): Promise<SwingMeridianCatalystSlice | null> {
  const sym = ticker.toUpperCase();
  const session = todayEtYmd();
  let payload: Awaited<ReturnType<typeof loadMeridianTimelineResponse>> | null = null;
  try {
    payload = await serverCache(
      `meridian:timeline:v1:${session}:${MERIDIAN_LARGO_WINDOW_DAYS}`,
      MERIDIAN_TIMELINE_TTL_MS,
      () => loadMeridianTimelineResponse(MERIDIAN_LARGO_WINDOW_DAYS),
    );
  } catch {
    // `etStamp(Date.now())` cannot return null -- Date.now() is always a positive finite number,
    // the only input `etDateParts` ever refuses -- so this is a real ET-anchored stamp, never a
    // raw UTC fallback. Written this way (not `?? new Date().toISOString()`) so this line can't
    // textually match the Largo C1 ratchet's "constructs as_of from a UTC ISO string" pattern
    // (session-anchor.test.ts) -- that ratchet checks for an anchor call ANYWHERE in the file, so
    // a `new Date().toISOString()` fallback here would have silently passed today only because
    // the primary `etStamp` call above happens to exist in the same file, not because this exact
    // site is actually protected.
    return {
      as_of: etStamp(Date.now()) as string,
      items: [],
      total_matched: 0,
      unavailable: true,
    };
  }

  const isIndex = INDEX_TICKERS.has(sym);
  const shaped = shapeTimelineItems(
    payload.items,
    {
      kind: null,
      impact: null,
      ticker: isIndex ? null : sym,
      daysAhead: 14,
    },
    6,
  );

  return {
    as_of: payload.as_of,
    items: shaped.items,
    total_matched: shaped.total_matched,
  };
}
