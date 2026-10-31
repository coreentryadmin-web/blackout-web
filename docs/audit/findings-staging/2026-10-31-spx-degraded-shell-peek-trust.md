# 2026-10-31 SPX Slayer off-hours fast path trusts a degraded bootstrap-shell peek for up to 24h

> **kind:** FINDING

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P2 data-correctness (Ask Largo / 5-engine standing mandate) |

## What broke

`evaluateSpxPlayState()`'s off-hours fast path (`src/features/spx/lib/spx-service.ts`) peeks the
`spx-merged:<date>` cache with a deliberate 24h staleness tolerance
(`peekMergedSpxDesk({ maxStaleMs: 24 * 60 * 60 * 1000 })`) and, whenever that peek returns
anything non-null with `market_open:false`, trusted it unconditionally and built the
member-facing closed-market snapshot straight from it.

That peeked bundle can legitimately be a **degraded bootstrap shell**
(`spx-desk.ts`'s `deskShellFromPulse`/`emptyDeskPayload`, `source:"none"`) rather than a real
merged-desk build: `loadMergedSpxDeskCore()` (`spx-desk-loader.ts`) composes its `desk` component
from `loadSpxDesk()`, which falls back to `deskShellFromPulse()` whenever `buildSpxDesk()` blows
`deskBootstrapMaxBlockMs()`. That fallback return is not an error — `loadMergedSpxDeskCore()`
resolves "successfully" with the degraded shell folded in, so `withServerCache`'s `refreshCache()`
writes this `source:"none"` bundle into `spx-merged:<date>` (local store + Redis) as if it were a
normal fresh value.

Once written, `peekMergedSpxDesk()`'s 24h tolerance means any replica that cached this exact
bundle keeps re-serving it from its own local store (`peekServerCache`'s local-fallback branch,
`server-cache.ts`) long after Redis's own short TTL (`deskCacheTtlMs()`, 10s default) has expired
on it — `peekServerCache` never invokes a loader or triggers any SWR background refresh, so
nothing on that path ever replaces it. The only thing that calls the real `loadMergedSpxDesk()`
off-hours is `maybeRefreshMergedSpxDeskOffHours()`, which is throttled by a fleet-wide NX lock
(one replica, once per `spxMergedDeskOffHoursRefreshIntervalSec()` == 5 min default) — and even
when it does fire on the same poisoned replica, it just re-reads the exact same still-within-TTL
local/Redis entry it already wrote, doing nothing.

`spx-play-engine.ts`'s own closed-market branch already knows this shape is untrustworthy — it
gates `closedConfluence` on `desk.source !== "none"` specifically because "a cold-cache bootstrap
shell ... has a real price and available:true but no GEX/flow layer ever merged in". But
`evaluateSpxPlayState()`'s off-hours fast path never applied that same check before deciding to
trust the peek — so it handed exactly the shape `spx-play-engine.ts` itself distrusts straight into
`closedMarketPlaySnapshot()`, producing a fully degenerate
`assessed:false`/`score:0`/`factors:[]`/`direction:null` response with a frozen `as_of`.

## Evidence

Live-reproduced 2026-10-31 (Saturday, market genuinely closed): two independent poll runs 5m35s
apart returned the byte-identical degenerate play response (same frozen `as_of`) while
`GET /api/market/spx/desk` and `GET /api/market/spx/bootstrap` showed a healthy, current desk
(`source:"polygon+uw-flow"`) throughout — a different cache lane entirely, never touched by this
poisoned `spx-merged:<date>` entry.

- `npx tsx --experimental-test-module-mocks --test src/features/spx/lib/spx-service-degraded-shell-peek.test.ts` —
  RED pre-fix (asserts `source:"polygon+uw-flow"`, got `"none"`), GREEN post-fix.
- `npx tsx --experimental-test-module-mocks --test src/features/spx/lib/spx-service-merged-desk-bg-refresh.test.ts` —
  3/3 green (sibling suite's closed-bundle fixture updated to a real-build `source`, since a
  `"none"`-source peek now correctly short-circuits before reaching the throttle logic that suite
  exercises).

## Fix

Apply the same `source !== "none"` check `spx-play-engine.ts` already uses, before trusting the
peeked bundle in `evaluateSpxPlayState()`'s off-hours fast path:

```ts
if (peeked && peeked.merged.source !== "none" && !peeked.merged.market_open && !isPremarketPlanningWindow()) {
```

A degraded shell now falls through to the real, `maxBlockMs`-bounded `loadMergedSpxDesk()` call —
exactly as already happens when the peek is null, the market is open, or it's premarket — instead
of committing to a known-degenerate answer for up to 24h.

## Blast radius

One call site (`evaluateSpxPlayState()`'s off-hours fast path). The sibling
`spx-service-merged-desk-bg-refresh.test.ts` suite's `closedBundle()` fixture was updated to a
real-build `source` so its throttle-lock assertions aren't spuriously defeated by the new guard —
that suite tests the background-refresh throttle wiring, not the degraded-shell trust gate, which
`spx-service-degraded-shell-peek.test.ts` now covers separately.
