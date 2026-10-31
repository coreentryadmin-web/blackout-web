> **kind:** FINDING

## HELIX flows member cache's "last good" fallback was shared across EVERY query, not scoped per cache key — FIXED

**Status:** FIXED (regression test added, RED→GREEN proven via `git stash` on the source file alone).

### Root cause

`readFlowsMemberCached` (`src/lib/flows-member-cache.ts`) serves `GET /api/market/flows` — the
HELIX tape and every per-ticker Vector universe view poll — through `withServerCache`, configured
with `maxBlockMs` + a `fallback` so a cold/slow build never blocks a member poll indefinitely.
The fallback was:

```ts
let lastGoodFlowsPayload: FlowsMemberPayload | null = null;
...
fallback: async () => lastGoodFlowsPayload ?? emptyFlowsMemberPayload(),
...
if (payload.count > 0) lastGoodFlowsPayload = payload;
```

`lastGoodFlowsPayload` is a single process-wide variable, but this function is called with a
distinct `cacheKey` per combination of `ticker` / `min_premium` / `since_hours` / `max_dte` /
`pageLimit` (`flowsMemberCacheKey`, used by both the member `/api/market/flows` route and every
Vector per-ticker universe view, which calls `registerVectorUniverseView(ticker)` and polls flows
scoped to that one ticker). `withServerCache`'s own doc comments explicitly name
`flows-member-cache.ts` as a caller that reaches its documented cold-miss/inflight-race fallback
branches (a genuinely cold key racing `maxBlockMs`, or a concurrent inflight build for that key
with no stale/Redis copy yet) — not a theoretical path.

So: query A (e.g. `ticker=NVDA`) builds successfully and sets the shared `lastGoodFlowsPayload`.
Query B, for a completely different cache key (e.g. `ticker=TSLA`), hits a cold/inflight miss on
ITS OWN key and falls back — and gets query A's NVDA rows back, mislabeled as the TSLA answer.
Worse, the substituted payload carries no `degraded` flag at all (`degraded` is only ever stamped
by `emptyFlowsMemberPayload()`; a payload taken from `lastGoodFlowsPayload` was captured from a
prior *successful* build and is indistinguishable from a fresh one), so neither the UI nor a caller
inspecting the response has any signal that the rows shown do not belong to the request that was
made.

This is the one outlier against an established convention this exact codebase otherwise follows
consistently for this exact purpose: `polygon-options-gex.ts`'s `lastGoodHeatmapLocal` (a
`Map<string, GexHeatmap>` keyed by `cacheKey`), `unusual-whales.ts`'s `lastGoodFlow0dteByTicker`
(keyed by ticker), and `public-gex-snapshot.ts`'s `loadLastGood(ticker)`/`lastGoodKey(ticker)` all
scope their "last good" substitute per query key — none of them collapse distinct queries onto one
shared slot. `flows-member-cache.ts` was the only one that did.

### Evidence

Added two tests to `src/lib/flows-member-cache.test.ts`, mocking `./db`, `./flow-gex-enrichment`
and `./server-cache` so `withServerCache`'s fallback branch can be driven deterministically
instead of racing real timers:

- **RED (pre-fix, confirmed via `git stash` on `flows-member-cache.ts` alone):** a successful
  `ticker=NVDA` query followed by a cold `ticker=TSLA` query (mock `withServerCache` calls
  `opts.fallback()` directly, exactly as the real cold-miss/inflight-race branches do) returned
  `count: 1` with NVDA's row under the TSLA request, and no `degraded` flag — 1/4 tests failed.
- **GREEN (post-fix):** the same scenario returns the honest empty/`degraded: true` payload for
  the TSLA query; a second test confirms a query's OWN prior-good rows are still correctly served
  back once that query's own key has built at least once — 4/4 passed.

### Blast radius

Single call site inside `flows-member-cache.ts` itself (`readFlowsMemberCached`'s `opts.fallback`
closure and the `if (payload.count > 0)` write after it) — the only two places that touched the
shared variable. `buildFlowsMemberPayload`, `warmFlowsMemberCaches`, and every other export are
unaffected. Consumers (`GET /api/market/flows`, used by the HELIX tape and every Vector per-ticker
universe view) get the fix automatically with no call-site changes.

### Fix rationale

Replaced the single `let lastGoodFlowsPayload` with `const lastGoodFlowsPayloadByKey = new
Map<string, FlowsMemberPayload>()`, keyed by the same `cacheKey` already computed from
`flowsMemberCacheKey(q)` for the `withServerCache` call. The fallback now reads
`lastGoodFlowsPayloadByKey.get(cacheKey)`, falling through to `emptyFlowsMemberPayload()` (honest,
correctly `degraded: true`) when THIS query has never built successfully, instead of borrowing a
different query's rows. The write-after-success line keys on the same `cacheKey` rather than
clobbering a single global slot.

Deliberately left unchanged: the map is unbounded (no eviction), matching the same convention the
other `lastGood*` maps cited above already use without a cap — the key space is bounded by the
actual distinct filter/ticker combinations members and Vector views request, not unbounded user
input.
