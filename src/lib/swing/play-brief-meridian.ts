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
    return {
      as_of: etStamp(Date.now()) ?? new Date().toISOString(),
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
