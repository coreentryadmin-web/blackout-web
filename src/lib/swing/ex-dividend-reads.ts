/**
 * Resolve ex-dividend context for a ticker/session — cached per (session, ticker).
 */
import { fetchPolygonDividends } from "@/lib/providers/polygon-largo";
import { exDividendCashForSession } from "./ex-dividend-adjustment";

const CACHE = new Map<string, { session: boolean; cash: number | null; at: number }>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function cacheKey(sessionDay: string, ticker: string): string {
  return `${sessionDay}:${ticker.toUpperCase()}`;
}

/** Best-effort ex-div session + cash amount for structural-stop adjustment (Q39). */
export async function resolveSwingExDividendContext(
  ticker: string,
  sessionDay: string,
): Promise<{ exDividendSession: boolean; exDividendCash: number | null }> {
  const key = cacheKey(sessionDay, ticker);
  const hit = CACHE.get(key);
  const now = Date.now();
  if (hit && now - hit.at < CACHE_TTL_MS) {
    return { exDividendSession: hit.session, exDividendCash: hit.cash };
  }
  try {
    const dividends = await fetchPolygonDividends(ticker);
    const resolved = exDividendCashForSession(dividends, sessionDay);
    CACHE.set(key, { ...resolved, at: now });
    return { exDividendSession: resolved.session, exDividendCash: resolved.cash };
  } catch {
    return { exDividendSession: false, exDividendCash: null };
  }
}

/** Test-only cache reset. */
export function resetSwingExDividendCache(): void {
  CACHE.clear();
}
