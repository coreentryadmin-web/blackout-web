/**
 * Failure-isolated cache wrapper — the fix for a real bug in `meridian-peer-reactions.ts`
 * (found 2026-11-09, Night Hawk/correctness-sweep lens: Promise.all failure-handling gaps).
 *
 * THE BUG. `loadOnePeerReaction` used to do:
 *
 *   return serverCache(key, ttlMs, async () => {
 *     try {
 *       ...real fetch...
 *     } catch (error) {
 *       return summarizePeerReaction(sym, []); // "no data" fallback
 *     }
 *   });
 *
 * The try/catch sat INSIDE the cached loader, so a transient failure (an upstream rate limit,
 * a timeout, a dropped connection — see the loader's own comment: "rate limit, no calendar
 * entry, transient provider error") never reached `serverCache` as a rejection. From the
 * cache's point of view the loader returned NORMALLY with a value, so `server-cache.ts`'s
 * `withServerCache` did exactly what it is supposed to do with a successful load: write the
 * "no data" fallback into the cache for the FULL configured TTL (6h here) and reset its own
 * failure-tracking (`failureCount`/`degradedKeys`) for the key, since as far as it can tell
 * nothing ever failed.
 *
 * The consequence: a single transient blip for one peer ticker froze "no data" for that
 * ticker for up to 6 hours, read back on every subsequent panel view as a measured fact
 * ("this peer has no reaction history") rather than what it actually was — a fetch failure
 * server-cache's own SWR/degraded-key machinery exists specifically to retry past. This is
 * the exact "absence-as-fact" trap this codebase's audit notes call out repeatedly elsewhere
 * (missing Benzinga entitlement, empty earnings cohorts, etc.) — just reached via a
 * Promise-based cache wrapper instead of a raw upstream read.
 *
 * THE FIX. Move the try/catch OUTSIDE the cached call: let a real loader failure propagate
 * THROUGH `cached(...)` so the cache's own failure tracking sees it (and, critically, never
 * writes the fallback into the cache — `withServerCache`'s `.then()` that calls
 * `setStoreEntry` only runs on the SUCCESS branch). The fallback is computed by `onFailure`
 * only for THIS call, every time the loader fails, so the next call for the same key gets a
 * fresh retry instead of a 6-hour-frozen "no data".
 *
 * Generic and dependency-injected (the `cached` param) specifically so it can be unit-tested
 * without pulling in `server-cache.ts`'s Redis/background-refresh machinery, AND without
 * importing anything that pulls in `"server-only"` (this file has no such import, unlike its
 * only caller, `meridian-peer-reactions.ts` — see CLAUDE.md's "extract the pure logic" rule).
 */
export async function loadWithFailureIsolatedCache<T>(
  cached: (key: string, ttlMs: number, loader: () => Promise<T>) => Promise<T>,
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
  onFailure: (error: unknown) => T
): Promise<T> {
  try {
    // The loader's rejection, if any, propagates THROUGH `cached` untouched — nothing here
    // intercepts it before the cache sees it, so a real failure is never mistaken for a
    // successful "no data" load and is never written into the cache.
    return await cached(key, ttlMs, loader);
  } catch (error) {
    return onFailure(error);
  }
}
