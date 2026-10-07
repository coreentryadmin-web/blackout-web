// In-flight de-duplication for `computeVectorFullState`'s live-compute path.
//
// Extracted into its own dependency-free file (same reasoning as
// `src/lib/swing/brief-source-timeout.ts`'s header) so it stays importable from a plain
// `tsx --test` file — `vector-full-state.ts` carries `import "server-only"`, which throws
// outside Next's RSC compiler.
//
// WHY THIS EXISTS (found during the 2026-10-07 Ask Largo audit sweep, live repro on
// GET /api/market/swing/play-brief for BE/MSFT/NVDA/TSLA/AMD — 100% of sampled requests logged
// BOTH "ecosystem context fetch failed" AND "Vector full-state fetch failed", each a
// SwingBriefSourceTimeout at exactly the 8s budget):
//
// `play-brief-context.ts` fans out `fetchEcosystemContext(ticker)` and
// `fetchVectorFullState(ticker, "all")` CONCURRENTLY in the same `Promise.all` — but
// `fetchEcosystemContext` itself calls `fetchVectorFullState(ticker, "all")` AGAIN internally
// (ecosystem-context.ts, its own `vectorFullState` arsenal read). Both calls share the exact same
// cache key (`vectorFullStateCacheKey` is keyed only on ticker+horizon), so on a cache HIT this is
// merely one extra cheap Redis round-trip — but on a cache MISS (the cron that is supposed to keep
// this warm, `vector-full-state-snapshot`, is ALREADY independently documented in FINDINGS.md as
// failing 70-98% of its universe most runs under rate-limiter contention) both callers see the miss
// at the same instant and BOTH launch the full `computeVectorFullState` fan-out (8+ provider/DB
// reads, two sequential batches) — literally doubling the exact load the cron's own fragility was
// already straining, on every single swing play-brief request, for no reason: both calls want the
// identical answer.
//
// The fix: de-duplicate concurrent `computeVectorFullState` calls for the same
// (ticker, horizon, timeframeMin) within one process so the second caller awaits the FIRST caller's
// in-flight promise instead of starting a second redundant fan-out. This is purely a call-count
// optimization — it changes nothing about correctness (every caller still gets the same resolved
// value) or caching semantics (the result is still written to Redis exactly once, by whichever
// caller's `fetchVectorFullState` wrapper reaches `writeVectorFullStateCache` first).
const inflight = new Map<string, Promise<unknown>>();

/**
 * Run `factory()` for `key`, or — if a call for the same `key` is already in flight — return
 * that same promise instead of invoking `factory()` again. The entry is removed once the promise
 * settles (success OR failure), so a later, non-overlapping call always gets a fresh invocation.
 */
export function dedupeInFlight<T>(key: string, factory: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const created = factory().finally(() => {
    // Only clear OUR OWN entry — a call that raced in after this one settled and overwrote the
    // map key with its own promise must not have that newer entry deleted out from under it.
    if (inflight.get(key) === created) inflight.delete(key);
  });
  inflight.set(key, created);
  return created;
}
