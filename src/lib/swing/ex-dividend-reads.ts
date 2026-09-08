/**
 * Resolve ex-dividend context for a ticker/session — cached per (session, ticker).
 */
import { fetchPolygonDividends } from "@/lib/providers/polygon-largo";
import { isWsUpdatedAtFresh } from "@/lib/ws/timestamp-freshness";
import { exDividendCashForSession } from "./ex-dividend-adjustment";

const CACHE = new Map<string, { session: boolean; cash: number | null; at: number }>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function cacheKey(sessionDay: string, ticker: string): string {
  return `${sessionDay}:${ticker.toUpperCase()}`;
}

/**
 * Best-effort ex-div session + cash amount for structural-stop adjustment (Q39).
 *
 * `dataUnavailable: true` means the Polygon dividends read itself failed (rate limit, timeout,
 * network blip) — NOT that today is confirmed not an ex-div session. Do not read a `false`
 * `exDividendSession` alongside `dataUnavailable: true` as "no ex-dividend happened": we simply
 * don't know. Collapsing "don't know" into "no" here is exactly the failure Q39 was built to
 * prevent (a legitimate ex-div gap misread as a structural-stop breach on a LONG position) — it
 * just moves the false-negative from "no ex-div data at all" to "a transient provider error",
 * which is silent and looks identical to a genuine non-ex-div day to every caller that only reads
 * `exDividendSession`. Callers that apply this to a capital-preservation decision (manage.ts's
 * `structuralStopBroken`) MUST check `dataUnavailable` and fail safe (skip enforcement this cycle)
 * rather than trusting the `false` at face value.
 */
export async function resolveSwingExDividendContext(
  ticker: string,
  sessionDay: string,
): Promise<{ exDividendSession: boolean; exDividendCash: number | null; dataUnavailable: boolean }> {
  const key = cacheKey(sessionDay, ticker);
  const hit = CACHE.get(key);
  const now = Date.now();
  if (hit && isWsUpdatedAtFresh(hit.at, CACHE_TTL_MS, now)) {
    return { exDividendSession: hit.session, exDividendCash: hit.cash, dataUnavailable: false };
  }
  try {
    const dividends = await fetchPolygonDividends(ticker);
    const resolved = exDividendCashForSession(dividends, sessionDay);
    CACHE.set(key, { ...resolved, at: now });
    return { exDividendSession: resolved.session, exDividendCash: resolved.cash, dataUnavailable: false };
  } catch {
    // Fail SAFE, not fail-open: the caller must not treat this as "confirmed no ex-div today".
    return { exDividendSession: false, exDividendCash: null, dataUnavailable: true };
  }
}

/** Test-only cache reset. */
export function resetSwingExDividendCache(): void {
  CACHE.clear();
}
