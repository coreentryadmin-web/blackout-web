> **kind:** FINDING

## `fetchUwFlow0dte`'s cold-start fallback still let a degenerate zero poison the shared Redis cache for the full TTL

| **Status** | FIXED |
|------------|-------|

**Symptom:** standing Ask Largo × Night Hawk Swings / SPX Slayer live-monitor mandate, follow-up
to the 2026-10-14 `isDegenerateFlowAggregate` fix (same file). That fix substitutes a per-process
`lastGoodFlow0dteByTicker` value before a degenerate 0DTE flow-per-strike poll ever reaches
`uwCacheGet`'s own write — but only covers the case where THIS process already has a good value to
substitute. On a genuine cold start (no `lastGood` entry yet in this process — e.g. right after a
deploy restarts every ECS task, or simply the first poll a process ever makes for a ticker), the
fetcher still RETURNED the bare `{0,0,0}` aggregate, and `uwCacheGet`'s generic write path
(`if (redis && result != null) redis.setex(...)`) is shape-agnostic — it has no concept of
"don't cache this one" — so it wrote the zero into the SHARED Redis cache for the full 120s TTL.
Every OTHER replica then read that cached zero for 2 minutes, including replicas whose OWN
in-process `lastGood` map already held a real value, because a Redis cache HIT short-circuits
before `fetchUwFlow0dte`'s fetcher (and therefore that process's own substitution logic) is ever
consulted. This is the exact live symptom the 2026-10-14 fix set out to kill, reopened specifically
at cold start.

**Root cause:** the cold-start branch returned its honest zero from the SAME closure `uwCacheGet`
auto-caches from, with no way to tell the generic helper "compute done, but don't persist this."
The sibling `uw-cache-refresh` cron write already follows the right discipline (skips the Redis
write entirely on a degenerate poll, unconditionally) — the live-read path only matched that
discipline when it had a substitute in hand, not in the harder cold-start case.

**Fix:** the cold-start branch now `throw`s a private `ColdStartDegenerateFlow0dteError` instead of
returning the zero. A promise rejection from the fetcher never reaches `uwCacheGet`'s write line
(proven directly against the real `uwCacheGet` with a literal fake Redis client — see test below),
so the shared cache is left untouched for the next real poll (by this or any other replica) to
populate honestly. `fetchUwFlow0dte` catches that one specific error type just outside the
`uwCacheGet` call and converts it back into the same honest zero for THIS ONE caller — external
behavior (a true cold start still "honestly" returns zero) is unchanged; only the shared-cache
side effect is removed.

**Verify:**
- `src/lib/providers/uw-shared-cache.test.ts` — new case: a fetcher passed to `uwCacheGet` that
  throws never reaches the literal fake Redis client's `setex`, and the rejection propagates to
  the caller.
- `src/lib/providers/unusual-whales.test.ts` — both existing `fetchUwFlow0dte` cases (degenerate
  poll substitutes the prior real aggregate; genuine cold-start poll served honestly as zero)
  still pass unchanged, confirming the externally observable contract didn't move.
