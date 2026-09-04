import "server-only";

import { fetchIndexDailyBars, fetchStockDailyBars } from "@/lib/providers/polygon";
import { priorDayFromDailyBars, priorEtYmd } from "@/lib/providers/spx-session";
import { formatEtDate } from "@/features/nighthawk/lib/session";
import {
  isVectorIndexTicker,
  normalizeVectorTicker,
  vectorPolygonMinuteSymbol,
} from "./vector-ticker";

export type VectorPriorDayOhlc = {
  pdh: number;
  pdl: number;
  pdc: number;
};

/**
 * Prior-session OHLC for a Vector ticker — shared by the chart's `/prior-day` read and the pin
 * forecaster's gap-context input. Walks back from `anchor` (displayed session YMD, default today)
 * to the most recent completed session via `priorDayFromDailyBars`. Best-effort: null when bars are
 * missing or incomplete.
 */
export async function getVectorPriorDayOhlc(
  ticker: string,
  anchor?: string
): Promise<VectorPriorDayOhlc | null> {
  const t = normalizeVectorTicker(ticker);
  const to = formatEtDate(new Date());
  const from = priorEtYmd(16);
  const sym = vectorPolygonMinuteSymbol(t);

  const bars = await (isVectorIndexTicker(t)
    ? fetchIndexDailyBars(sym, from, to)
    : fetchStockDailyBars(t, from, to)
  ).catch(() => []);

  const { pdh, pdl, pdc } = priorDayFromDailyBars(bars, anchor);
  if (
    pdh == null ||
    pdl == null ||
    pdc == null ||
    !(pdh > 0 && pdl > 0 && pdc > 0)
  ) {
    return null;
  }
  return { pdh, pdl, pdc };
}
