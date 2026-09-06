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

export type SwingMeridianCatalystSlice = {
  as_of: string;
  items: LargoTimelineItem[];
  total_matched: number;
  unavailable?: boolean;
};

const INDEX_TICKERS = new Set(["SPX", "SPXW", "SPY", "QQQ", "IWM", "VIX", "NDX"]);

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
      as_of: etStamp(Date.now()),
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
