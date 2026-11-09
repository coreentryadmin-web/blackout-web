/**
 * Failure-isolated cache wrapper for `meridian-opex-cross-market.ts`'s `groupedDailyForDate`.
 *
 * THE BUG (found this round, same "swallow-failure-before-the-combinator, cache the degraded
 * result" class already fixed twice elsewhere in this file's history — `meridian-peer-reactions
 * .ts`'s `loadOnePeerReaction` and `dossier.ts`'s `fetchFinancialsBundle`). The original
 * `groupedDailyForDate` did:
 *
 *   return serverCache(key, ttlMs, () =>
 *     fetchDailyMarketSummary(date).then((data) => data.results ?? []).catch(() => [])
 *   );
 *
 * The `.catch(() => [])` sat INSIDE the loader passed to `serverCache`, so a genuine upstream
 * failure (Polygon grouped-daily down, rate-limited, a network blip) never reached `serverCache`
 * as a rejection — the loader always resolved successfully, with an empty array standing in for
 * "nothing failed, this date just has no movers." `server-cache.ts`'s `withServerCache` only
 * writes a value into its store on the loader's SUCCESS branch (`.then`) — a rejection instead
 * increments `failureCount`/marks the key `degradedKeys` so the SWR layer retries soon. Catching
 * inside the loader defeats that entirely: the empty-movers fallback gets written into the cache
 * for the FULL `OPEX_CROSS_CACHE_MS` (30 minutes), and every subsequent read of
 * `loadMeridianOpexCrossMarket` for that date — across every member who opens the OpEx
 * cross-market panel in that window — sees "no movers that session" when the real fact is
 * "the grouped-daily fetch for that date failed and nobody has retried it yet."
 *
 * THE FIX. Move the catch OUTSIDE the cached call (`loadOpexGroupedDailyOrEmpty` below): the
 * loader's rejection propagates THROUGH `cached(...)` untouched, so a real failure is never
 * written into the cache and `server-cache.ts`'s own degraded-key retry machinery actually sees
 * it. The empty-array fallback is now computed by the CALLER of `cached(...)`, fresh on every
 * call that still fails — not baked into the cached value itself.
 *
 * Extracted into this pure, side-effect-free sibling module (no `"server-only"` import, unlike
 * `meridian-opex-cross-market.ts` itself) so the fix is unit-testable without pulling in
 * `server-cache.ts`'s Redis/background-refresh machinery or Next.js's server-only guard — same
 * discipline as this repo's standing "extract pure logic" rule.
 */
export async function loadOpexGroupedDailyOrEmpty<T>(
  cached: (key: string, ttlMs: number, loader: () => Promise<T[]>) => Promise<T[]>,
  key: string,
  ttlMs: number,
  loader: () => Promise<T[]>
): Promise<T[]> {
  try {
    // Nothing intercepts the loader's rejection before `cached` sees it — a real upstream
    // failure is therefore never mistaken for a successful "no movers" load and never written
    // into the cache.
    return await cached(key, ttlMs, loader);
  } catch {
    return [];
  }
}
