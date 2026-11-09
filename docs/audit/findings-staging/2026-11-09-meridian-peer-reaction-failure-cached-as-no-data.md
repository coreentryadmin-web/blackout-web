# 2026-11-09: Meridian peer-reaction fetch failures were cached as "no data" for 6 hours

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

`GET /api/market/meridian/peer-reactions` (live production route, consumed by the Sector Peers
panel and `meridian-peer-cohort-for-largo.ts`) could permanently misreport a transient upstream
failure for one peer ticker as "this name has no earnings reaction history" for up to six hours.
Found via the Promise.all failure-handling lens of this round's correctness sweep.

## Root cause

`loadOnePeerReaction` (`src/lib/meridian/meridian-peer-reactions.ts`) wrapped its per-ticker fetch
in `serverCache(key, 6h, loader)`, but put the `try/catch` **inside** the cached `loader`:

```ts
return serverCache(key, CACHE_TTL_MS, async () => {
  try {
    const { print_history } = await loadMeridianEarningsPrintHistory(sym, PRINTS_PER_PEER);
    return summarizePeerReaction(sym, print_history);
  } catch (error) {
    return summarizePeerReaction(sym, []); // <-- fallback computed INSIDE the cached loader
  }
});
```

`src/lib/server-cache.ts`'s `withServerCache`/`refreshCache` is deliberately built so that a
loader's **rejection** is never cached — only the success branch (`loader().then(...)`) calls
`setStoreEntry`, and a rejection instead increments `failureCount`/`degradedKeys` so the SWR layer
retries on the next call. But because the catch lived inside the loader, a transient failure (the
loader's own comment names "rate limit, no calendar entry, transient provider error") never
surfaced as a rejection at all — from `serverCache`'s point of view the loader returned normally
with a value (the empty-history fallback), so that fallback got written into the cache for the
**full 6-hour TTL**, and the cache's own failure-tracking never even saw anything went wrong.

The result: one rate-limited or timed-out fetch for, say, `BBWI` froze "BBWI has no peer reaction
data" for up to six hours, read back by every subsequent panel view (and by Largo's peer-cohort
tool) as a measured fact rather than what it actually was — a fetch failure that `server-cache.ts`'s
own degraded-key retry machinery exists specifically to recover from. This is the same
"absence-as-fact" trap this codebase's audit notes call out repeatedly elsewhere (e.g. the
Benzinga-entitlement-loss findings), just reached through a cache wrapper instead of a raw read.

## Evidence (RED → GREEN)

Extracted the cache-wrapping logic into a new, pure, side-effect-free sibling module
(`src/lib/meridian/peer-reaction-cache-wrap.ts` — `meridian-peer-reactions.ts` imports
`"server-only"` so it can't be unit-tested directly, per this repo's standing "extract the pure
logic" rule) and wrote `peer-reaction-cache-wrap.test.ts` against it, using a minimal fake TTL
cache whose `cached(key, ttlMs, loader)` shape mirrors the real `server-cache.ts` precisely
(writes to its store only on the loader's success branch — "failing keys never enter `store`").

RED: temporarily reverted `loadWithFailureIsolatedCache`'s body to the exact original bug shape
(catch living inside the `cached(...)` call) and ran the suite —
`a loader failure is NOT cached — the next call retries` failed: `1 !== 0`
(the fallback WAS written into the fake cache's store; the second call then replayed the stale
fallback instead of retrying even though the loader would now succeed, 1 loader call total
instead of 2).

GREEN: restored the fix (catch moved outside `cached(...)`) — all 3 tests in the file pass,
including a third test that deliberately re-creates the old buggy pattern inline for contrast and
asserts it exhibits the defect, so the fix and the bug are both pinned in the same file.
`npx tsc --noEmit` clean across the project.

## Fix

Moved the `try/catch` outside the cache boundary via a new generic helper,
`loadWithFailureIsolatedCache(cached, key, ttlMs, loader, onFailure)` — the loader's rejection now
propagates *through* the cache call untouched (so `server-cache.ts`'s own failure-tracking sees it
and nothing gets cached), and `onFailure` is invoked fresh on every call that hits a real failure,
never cached. External behavior for a healthy fetch, or the "one bad peer doesn't fail the whole
cohort" guarantee `Promise.all` relies on, is unchanged — only the failure case stops being frozen
into the cache.

## Blast radius

One function (`loadOnePeerReaction`), one new pure helper module, one live API route
(`GET /api/market/meridian/peer-reactions`) and its two known consumers: the Sector Peers panel
and `src/lib/largo/meridian-peer-cohort-for-largo.ts` (Largo's own peer-cohort data — a rendering/
data-correctness consumer, not the excluded tool-dispatch layer itself). No other caller of
`loadMeridianPeerReactions`/`loadOnePeerReaction` exists.

A grep for the same shape (`serverCache(...)` whose loader's own `try/catch` computes the
fallback value *inside* the cached call, rather than per-sub-fetch `.catch()` calls combined via
`Promise.all` before the cache boundary) turned up one more candidate worth a dedicated look next
round: `src/features/nighthawk/lib/dossier.ts`'s `fetchFinancialsBundle` — there every *individual*
upstream call already has its own `.catch(() => null/[])` BEFORE the `Promise.all`, so the cached
loader itself never throws even on a total outage, caching an all-null bundle for the full
`TTL.REFERENCE` window. Left unfixed here (single-issue-per-PR; it's a materially different shape
— independent per-field degradation vs. one whole-ticker degradation — and deserves its own
dedicated before/after check rather than being folded into this fix).
