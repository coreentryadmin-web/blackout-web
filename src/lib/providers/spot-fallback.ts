import { fetchUwStockState } from "@/lib/providers/unusual-whales";

/** Map Polygon index options roots (I:SPX) and equity roots to UW stock-state tickers. */
export function uwTickerFromOptionsRoot(optionsRoot: string): string {
  const root = optionsRoot.toUpperCase();
  if (root.startsWith("I:")) return root.slice(2);
  return root;
}

type SpotQuote = { price: number; change_pct: number };

const mem = new Map<string, { at: number; quote: SpotQuote }>();
const MEM_TTL_MS = 5_000;

/**
 * UW's `/stock-state` endpoint does not serve index tickers at all — confirmed live against
 * production UW: SPX, VIX, NDX, and RUT all return HTTP 422 "Stock state data is not available
 * for index ticker X" (SPY, a real ETF rather than an index, returns 200 normally). This function
 * is called explicitly with index option roots (e.g. `I:SPX` from socket-cluster-health.ts) as a
 * fallback for when Polygon's indices feed is down — so without this check, the fallback could
 * never actually work for the exact ticker (SPX) it exists to protect, while still burning a
 * network round-trip and polluting UW's error-rate metrics on every attempt. Measured live
 * 2026-08-28: 13/31 UW calls errored in one 5-minute window, entirely this call for SPX.
 * A real index-compatible spot source exists (`/spot-exposures/strike` carries a `price` field
 * and IS index-compatible — used elsewhere in this file's siblings for GEX), but wiring it in
 * here changes this function's cost profile and `change_pct` semantics (that endpoint carries no
 * prior-close field), so it's left as a follow-up rather than folded into this fix.
 */
const UW_STOCK_STATE_UNSUPPORTED_TICKERS = new Set(["SPX", "VIX", "NDX", "RUT"]);

export function isUwStockStateUnsupportedIndex(optionsRoot: string): boolean {
  const ticker = uwTickerFromOptionsRoot(optionsRoot);
  return UW_STOCK_STATE_UNSUPPORTED_TICKERS.has(ticker);
}

/**
 * Best-effort spot from UW `/stock-state` when Polygon WS/REST/cluster snapshot are all cold.
 * Short in-process cache (5s) so burst callers (heatmap-warm, data-correctness) share one UW hit.
 */
export async function resolveSpotFromUwStockState(
  optionsRoot: string,
  now = Date.now()
): Promise<SpotQuote | null> {
  if (isUwStockStateUnsupportedIndex(optionsRoot)) return null;
  const uwTicker = uwTickerFromOptionsRoot(optionsRoot);
  if (!uwTicker) return null;

  const hit = mem.get(uwTicker);
  if (hit && now - hit.at < MEM_TTL_MS) return hit.quote;

  try {
    const raw = await fetchUwStockState(uwTicker);
    const row =
      raw && typeof raw === "object" && "data" in (raw as Record<string, unknown>)
        ? ((raw as { data?: Record<string, unknown> }).data ?? null)
        : (raw as Record<string, unknown> | null);
    if (!row) return null;

    const price = Number(row.close ?? row.price ?? row.last ?? 0);
    if (!(price > 0)) return null;

    const prev = Number(row.prev_close ?? row.previous_close ?? 0);
    const change_pct =
      prev > 0 ? Number((((price - prev) / prev) * 100).toFixed(2)) : 0;

    const quote = { price, change_pct };
    if (mem.size > 50) mem.clear();
    mem.set(uwTicker, { at: now, quote });
    return quote;
  } catch {
    return null;
  }
}
