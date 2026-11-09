# 2026-11-09: Meridian OpEx cross-market grouped-daily fetch caught its own failure INSIDE the `serverCache` loader — a Polygon outage froze "no movers" for 30 minutes

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

`src/lib/meridian/meridian-opex-cross-market.ts`'s `groupedDailyForDate` — the per-date
grouped-daily (market-wide movers) fetch backing `loadMeridianOpexCrossMarket`'s "top
gainer/loser" rows for each prior monthly OpEx session — caught `fetchDailyMarketSummary`'s own
failure **inside** the function passed to `serverCache`, the exact "swallow-failure-before-the-
combinator, cache the degraded result" bug class this file's history has already fixed twice
elsewhere this session (`meridian-peer-reactions.ts`'s `loadOnePeerReaction`, PR #7773, open;
`dossier.ts`'s `fetchFinancialsBundle`, PR #7787, merged). Found via this round's targeted
broad `serverCache(` grep across `src/lib/meridian/**`/`src/lib/providers/**` for the same
shape, per round 495's own handoff note.

## Root cause

Before this fix:

```ts
async function groupedDailyForDate(date: string) {
  return serverCache(`meridian:opex:grouped:${date}`, OPEX_CROSS_CACHE_MS, () =>
    fetchDailyMarketSummary(date)
      .then((data) => data.results ?? [])
      .catch(() => [])
  );
}
```

`src/lib/server-cache.ts`'s `withServerCache`/`refreshCache` is deliberately built so a loader's
**rejection** is never written into the cache — only the success (`.then`) branch calls
`setStoreEntry`; a rejection instead increments `failureCount`/marks the key `degradedKeys` so
the SWR layer retries soon (see that file's own header comments, and its sibling `refreshCache`
implementation).

But the `.catch(() => [])` above sat **inside** the function handed to `serverCache`, so from
`withServerCache`'s point of view the loader always resolved normally — with an empty array
standing in for "this session had no movers" even when the real cause was a genuine upstream
failure (Polygon grouped-daily down, rate-limited, a dropped connection). The empty-array
fallback then got written into the cache for the full `OPEX_CROSS_CACHE_MS` (30 minutes), and
every member who opened the Meridian OpEx cross-market panel in that window saw "no movers that
session" for a date whose real top-gainer/top-loser data was never actually fetched — the exact
"absence-as-fact" trap this repo's audit notes call out repeatedly elsewhere, reached here via a
Promise-based cache wrapper rather than a raw upstream read. Because `groupedDailyForDate` is
called once per prior-OpEx date (`Promise.all(dates.map((d) => groupedDailyForDate(d)))`, 6
dates by default), a single correlated Polygon outage could silently zero out movers across the
ENTIRE 6-session cross-market comparison at once, each date independently frozen for its own
30-minute window.

## Blast radius

Grepped every `serverCache(` call site across `src/lib/meridian/**` and `src/lib/providers/**`
(the two directories round 495 flagged) for the same shape (a `.catch()` living inside the
function passed as the loader). This was the only genuine instance found this round —
`meridian-benzinga-earnings.ts`'s several `serverCache` calls, `meridian-timeline-server.ts`'s
`loadMeridianFdaTimeline`, `meridian-ticker-lookup.ts`, `meridian-reaction.ts`,
`meridian-earnings-expected-move.ts`, `meridian-fda-history.ts`, and the `providers/polygon*`
call sites were all checked and already catch OUTSIDE the cached call (or don't catch at all,
letting a real failure propagate and correctly go uncached). `groupedDailyForDate` is private to
this file with exactly one call site; no duplicate copy of the buggy pattern exists elsewhere.

## Evidence (RED → GREEN)

`meridian-opex-cross-market.ts` imports `"server-only"`, so per this repo's standing rule the
cache-wrapping logic was extracted into a new, pure, side-effect-free sibling module —
`src/lib/meridian/meridian-opex-grouped-daily.ts` (`loadOpexGroupedDailyOrEmpty`) — and tested
against a minimal fake TTL cache (`meridian-opex-grouped-daily.test.ts`) whose `cached(key,
ttlMs, loader)` shape mirrors `server-cache.ts` precisely: it writes to its store only on the
loader's success branch, exactly like the real `withServerCache`/`refreshCache`.

**RED**: temporarily reverted `loadOpexGroupedDailyOrEmpty`'s body to the exact original bug
shape (`cached(key, ttlMs, () => loader().catch(() => []))` — the catch living inside the
function handed to `cached`). Result: `a loader failure is NOT cached — the next call retries`
failed (`true !== false` — the empty fallback WAS written into the fake cache's store; the
second call then replayed the stale fallback instead of retrying, with only 1 loader invocation
total instead of 2).

**GREEN**: restored the fix (catch moved outside the cached call). All 3 tests pass, including
a third test that deliberately re-creates the old buggy pattern inline for direct contrast and
asserts it exhibits the defect — so both the bug and the fix are pinned in the same file.

`npx tsc --noEmit` clean (Node 20). Touched tests: `meridian-opex-grouped-daily.test.ts` (3/3
pass) and the sibling `meridian-opex-cross-market-core.test.ts` (unaffected, still 6/6 pass) run
together clean.

## Fix rationale

Mirrors the exact fix shape already applied twice in this codebase for this bug class — move
the `.catch` to wrap the `serverCache`/`cached` call from the OUTSIDE, so a real rejection
propagates through untouched and the cache's own degraded-key retry machinery actually observes
it, while a genuinely empty result (confirmed by a second regression test) still caches
normally, since that IS a real, cacheable fact. Deliberately did not reuse PR #7773's
(currently open, unmerged) `peer-reaction-cache-wrap.ts` helper — this fix is self-contained and
does not take a dependency on another lane's in-flight PR.
