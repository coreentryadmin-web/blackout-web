# 2026-11-09: Vector 4H chart route caches a partial per-day fetch failure as if it were a complete result

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

`GET /api/market/vector/4h-bars` (`src/app/api/market/vector/4h-bars/route.ts`) builds its 4-hour
candle series by walking back `LOOKBACK_TRADING_DAYS=12` trading days and fetching each day's
intraday minute bars individually via `fetchIndexMinuteBars`/`fetchStockMinuteBars` under a
`Promise.all`, with each per-day call wrapped in `.catch(() => [])`.

That `.catch(() => [])` conflates two completely different outcomes into the identical value:
(1) a day that **legitimately has no bars** (a weekend/holiday past the walk-back's edge — the
route's own existing test already simulates this for older sessions), and (2) a day whose fetch
**genuinely threw** (a network error, a rate limit, or a provider-side entitlement loss — see
CLAUDE.md's 2026-11-07 Polygon/Massive real-time-snapshot entitlement-loss incident for exactly
this failure shape hitting this same provider). Both read as `[]` to every line of code below the
`Promise.all`, so there is no way, by the time the aggregator runs, to tell "today legitimately had
no candles" apart from "we don't actually know what today's candles are."

The cache-write guard a few lines later only checked `bars.length > 0` — "is there *some* data" —
never "did every day's fetch actually succeed." So a transient failure on even one of the twelve
days (most dangerously the newest/most-recent session, since the walk-back starts at today and
works backward) produced a result **silently missing that session's candles**, and that degraded-
but-believable-looking result then passed the `bars.length > 0` guard and got pinned in the shared
cache (`sharedCacheSet`, `src/lib/shared-cache.ts`) for the full `CACHE_TTL_SEC` (120s) as though it
were a complete, successful fetch. The next ~120 seconds of requests for that ticker's 4H chart all
served the same silently-incomplete series, with no signal anywhere that a day's worth of candles
was actually missing because of a failure rather than a real market closure.

This is the same "swallow failure before the combinator, cache the degraded result" bug class
already fixed three times earlier this session in `src/lib/meridian/**`/`src/lib/providers/**`
(see `docs/audit/FINDINGS.md`) — a `Promise.all`/loader body swallows a real rejection into a
cacheable "success" value before the caching layer itself ever gets a chance to see anything
reject. Here it reaches a sibling caching primitive (`sharedCacheGet`/`sharedCacheSet` instead of
`withServerCache`) via a day-level `Promise.all` instead of a component-level one, but the shape is
identical.

### Evidence

New regression test `src/app/api/market/vector/4h-bars/route.test.ts`:
- `fetchStockMinuteBars` is mocked so TSLA's most-recent day returns one real bar, its second day
  **throws** (`new Error("upstream blip")`, simulating a genuine upstream failure — not "no data"),
  and the rest legitimately return `[]`.
- `sharedCacheGet`/`sharedCacheSet` are mocked with a spy so the write-gate can be asserted
  directly, isolated from the real module's Redis/in-memory fallback.

**RED (pre-fix, confirmed via `git stash` on `route.ts` alone, test unchanged):**
```
a result built from a genuine per-day fetch failure must not be cached
1 !== 0
expected: 0
actual: 1
```
`sharedCacheSet` was called once — the route cached the result even though one of the twelve days'
fetches genuinely threw.

**GREEN (post-fix):** the same test now passes — `sharedCacheSet` is called 0 times when any day
truly fails, while the response itself still returns the one real bar it has (a partial failure
must never blank the whole chart for the request that hit it — only the *cache write* is withheld).
A second new test confirms the all-succeed path (including legitimately-empty older sessions) is
still cached exactly as before, so the fix narrows the cache-write guard without touching the
no-failure happy path.

## Fix

Track whether any day's fetch genuinely threw (`anyFetchFailed`, set inside the `.catch()` before
returning `[]`) and require `!anyFetchFailed` alongside the existing `bars.length > 0` check before
calling `sharedCacheSet`. The response to the CURRENT request is unchanged — it still returns
whatever real bars were fetched, best-effort, exactly as before — only the decision to *pin that
result in the shared cache* now requires every day's fetch to have actually succeeded.

**Why this fix and not an alternative.** A stricter fix (don't return a response at all / 500 on
any per-day failure) was rejected: the existing design deliberately favors a best-effort partial
chart over an empty one for the live request (the file's own comment: "a transient upstream blip"
should not mean "minutes of an empty chart" — this fix keeps that for the *response*, it only
tightens what may be *cached*). A looser fix (retry the failed day before giving up) was also
rejected as out of scope/higher blast-radius for a single-issue PR — `fetchIndexMinuteBars`/
`fetchStockMinuteBars` already have their own retry/backoff semantics upstream; duplicating that
here would be a second, divergent retry policy.

## Blast radius

Grepped every other `src/app/api/**` route using `sharedCacheSet`/`sharedCacheGet` (26 files).
The sibling `daily-bars/route.ts` has the identical single-fetch `.catch(() => [])` shape but
**does not cache its result at all** — a swallowed failure there just returns an empty array
directly to that one request, with no stale-cache-pinning consequence, so it is not a second
instance of this specific bug (nothing gets pinned for a future request to inherit). No other
route in the grep combines a day/component-level `Promise.all` + `.catch(() => [])` feeding a
`bars.length > 0`-only cache-write guard the way `4h-bars/route.ts` did. The remaining
`sharedCacheSet` call sites are cron warmers and single-fetch routes with different shapes,
out of scope for this single-issue PR — left as a lead for a future round if a similar
Promise.all-plus-cache shape turns up elsewhere.

## Files changed

- `src/app/api/market/vector/4h-bars/route.ts` — track `anyFetchFailed`, gate the cache write on it.
- `src/app/api/market/vector/4h-bars/route.test.ts` — two new tests (partial-failure-not-cached,
  all-succeed-still-cached) + a ticker-scoped `fetchStockMinuteBars` branch for TSLA + a
  `sharedCacheGet`/`sharedCacheSet` spy mock.
