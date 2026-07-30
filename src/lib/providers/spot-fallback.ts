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
 * Best-effort spot from UW `/stock-state` when Polygon WS/REST/cluster snapshot are all cold.
 * Short in-process cache (5s) so burst callers (heatmap-warm, data-correctness) share one UW hit.
 */
export async function resolveSpotFromUwStockState(
  optionsRoot: string,
  now = Date.now()
): Promise<SpotQuote | null> {
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
