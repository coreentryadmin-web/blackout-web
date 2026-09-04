import "server-only";

import { macroEventsOnDateLive } from "@/lib/providers/macro-events";
import { fetchIndexMinuteBars, fetchStockMinuteBars } from "@/lib/providers/polygon";
import {
  isVectorIndexTicker,
  normalizeVectorTicker,
  vectorPolygonMinuteSymbol,
} from "@/features/vector/lib/vector-ticker";
import { logReturnsFromMinuteBars } from "@/features/spx/lib/spx-pin-recent-returns";

/** Session trend + macro inputs for `forecastPin` degrade logic — shared by SPX desk + Vector pin. */
export async function pinForecastTrendInputs(
  ticker: string,
  sessionYmd: string
): Promise<{ recentReturns?: number[]; macroEvent: boolean }> {
  const sym = normalizeVectorTicker(ticker);
  const barsPromise = isVectorIndexTicker(sym)
    ? fetchIndexMinuteBars(vectorPolygonMinuteSymbol(sym), sessionYmd, sessionYmd).catch(() => [])
    : fetchStockMinuteBars(sym, sessionYmd, sessionYmd).catch(() => []);

  const [bars, macro] = await Promise.all([
    barsPromise,
    macroEventsOnDateLive(sessionYmd).catch(() => []),
  ]);

  const rets = logReturnsFromMinuteBars(bars);
  const macroEvent = macro.some((e) => String(e?.impact ?? "").toLowerCase() === "high");
  return {
    recentReturns: rets.length >= 10 ? rets : undefined,
    macroEvent,
  };
}
