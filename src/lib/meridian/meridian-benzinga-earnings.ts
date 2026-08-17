import "server-only";

import { fetchBenzingaStructuredEarnings } from "@/lib/providers/polygon";
import { serverCache } from "@/lib/server-cache";

const BENZINGA_TIMELINE_TTL_MS = 30 * 60 * 1000;
const BENZINGA_TICKER_TTL_MS = 10 * 60 * 1000;

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** Market-wide Benzinga earnings rows for the Meridian timeline window. */
export async function loadBenzingaEarningsWindow(todayYmd: string, daysAhead: number) {
  const dateLte = addDaysYmd(todayYmd, Math.max(1, daysAhead));
  return serverCache(`meridian:benzinga:earnings:${todayYmd}:${daysAhead}`, BENZINGA_TIMELINE_TTL_MS, () =>
    fetchBenzingaStructuredEarnings({
      dateGte: todayYmd,
      dateLte,
      limit: 50,
    })
  ).catch(() => []);
}

/** Ticker-scoped Benzinga earnings — upcoming + recent prints for enrichment. */
export async function loadBenzingaTickerEarnings(ticker: string, eventDate: string | null) {
  const sym = ticker.trim().toUpperCase();
  const dateGte = eventDate ? addDaysYmd(eventDate, -400) : addDaysYmd(new Date().toISOString().slice(0, 10), -400);
  return serverCache(`meridian:benzinga:ticker:${sym}:${eventDate ?? "next"}`, BENZINGA_TICKER_TTL_MS, () =>
    fetchBenzingaStructuredEarnings({
      ticker: sym,
      dateGte,
      limit: 12,
    })
  ).catch(() => []);
}
