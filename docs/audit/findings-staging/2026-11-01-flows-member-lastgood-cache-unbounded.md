> **kind:** FINDING

# `lastGoodFlowsPayloadByKey` grows unbounded — keyed by caller-supplied filter floats/strings, never capped

| | |
|---|---|
| **Area** | HELIX member flows tape — `src/lib/flows-member-cache.ts` (`/api/market/flows`) |
| **Severity** | P3 — process-memory leak over a long-running ECS task, not a correctness bug on any single request |
| **Status** | FIXED — PR open |

## Root cause

`readFlowsMemberCached`'s "last good" fallback cache:

```ts
const lastGoodFlowsPayloadByKey = new Map<string, FlowsMemberPayload>();
...
if (payload.count > 0) lastGoodFlowsPayloadByKey.set(cacheKey, payload);
```

is keyed by `flowsMemberCacheKey(q)` (`src/lib/flows-member-cache-key.ts`):

```ts
return `flows:pg:${since}:${minPrem}:${ticker}:${maxDte}:${q.pageLimit}`;
```

`minPrem` and `ticker` come straight from the `/api/market/flows` route's own query-param
parsing (`src/app/api/market/flows/route.ts`):

```ts
const min_premium = Number(sp.get("min_premium") ?? 0) || undefined;
const ticker = sp.get("ticker") ?? undefined; // free text, not clamped to a known universe
```

`min_premium` is an arbitrary float a member can type into the HELIX tape's premium filter, and
`ticker` is free text (not limited to the fixed heatmap/vector universe other per-ticker caches in
this codebase use). Every distinct `(since_hours, min_premium, ticker, max_dte, pageLimit)`
combination any member has ever queried gets its own permanent entry in this `Map`, with no TTL
and — unlike every comparable cache in this codebase — no size cap. The comment above the `Map`
cites `lastGoodHeatmapLocal` (`polygon-options-gex.ts`) and `lastGoodFlow0dteByTicker`
(`unusual-whales.ts`) as the precedent for this per-key design, but both of those are keyed ONLY
by ticker — a small, fixed universe (~100-200 symbols) — so they stayed implicitly bounded without
needing an explicit cap. This Map's key space is open-ended, so it is not.

This was introduced by a round-190 fix (documented in the surrounding comment) that moved this
cache from a single shared slot to a per-key `Map` specifically to stop a correctness bug — a
cold/degraded query for one filter combination being served a *different* filter combination's
stale rows as its fallback. That fix is correct and is kept as-is here; it just never carried over
the bound/eviction convention every other `*Cache`/`lastGood*` `Map` in this codebase already
uses, e.g. `polygon-options-gex.ts`'s `positioningCache`/`ivTermCache`/`realizedVolCache`
(`if (cache.size > 200) cache.clear()`), this file's own sibling `gex-heatmap` route maps
(`overlayMem`/`nighthawkContextMem`/`lastForceAt`/`explainMem`, same `> 200` guard), and
`shared-cache.ts`'s in-memory fallback (an explicit LRU-with-cap). Found via a broadened
repo-wide sweep for `new Map<`/`new Set<` (generic-typed module-scope caches), checking each
module-scope hit for an eviction mechanism — this was the one hit, outside already-fixed/excluded
areas, with none.

## Evidence (RED → GREEN)

Added a regression test (`src/lib/flows-member-cache.test.ts`) that drives
`lastGoodFlowsPayloadByKey` past its cap with 200+ distinct `min_premium` values, then replays the
FIRST query's own cache key cold (through `withServerCache`'s documented `opts.fallback()` branch,
the same branch the existing pre-fix test in this file already exercises). Pre-fix, that replay
always comes back with the first query's own stale rows (`count: 1`) because nothing ever evicts
it, however many other distinct filter combinations have been queried since. Verified RED by
temporarily reverting the eviction call (`setLastGoodFlowsPayload` falls back to a bare
`.set()` with no cap) and re-running the new test:

```
npx tsx --experimental-test-module-mocks --test src/lib/flows-member-cache.test.ts
# pre-fix:  4 pass / 1 fail  (actual 1 !== expected 0 — old entry never evicted)
# post-fix: 5 pass / 0 fail
```

Also ran `tsc --noEmit` (clean) and `eslint` on both changed files (clean).

## Blast radius

`lastGoodFlowsPayloadByKey` has exactly one write call site (`readFlowsMemberCached`) and no
readers outside this file, so the fix is fully contained to `src/lib/flows-member-cache.ts`. No
other module reads or writes this `Map`.

## Fix rationale

Reused the exact "cap then `clear()`" convention already standard across every other
process-local cache `Map` in this codebase (`MAX_LAST_GOOD_FLOWS_KEYS = 200`, matching the `200`
threshold used everywhere else) rather than inventing a new LRU/TTL scheme for one cache — this
`Map` only ever serves a degraded-mode "last good" substitute, never the primary data path, so an
occasional full `clear()` (reached only once 200 distinct filter combinations have been queried
since the last clear) costs nothing beyond a handful of members briefly losing their own stale
fallback during a genuinely rare cold/inflight-miss window — strictly better than unbounded growth
for the lifetime of the process. Deliberately left unchanged: the per-key design itself (the
round-190 correctness fix this builds on), `flowsMemberCacheKey`'s shape, and every other cache in
the file.
