> **kind:** `FINDING`

## `breakout-discovery.ts`'s intraday minute-bar refresh fan-out (up to 40 concurrent Polygon calls, no local bound) — the 0DTE sibling of PR #7832's swing-discovery fix, confirmed and fixed

| | |
|---|---|
| **Status** | FIXED |
| **Area** | Night Hawk 0DTE BREAKOUT discovery — `src/lib/zerodte/breakout-discovery.ts` (`discoverBreakoutSetups`) |
| **Severity** | P1 — a single call site capable of firing 40 concurrent Polygon REST calls into a SHARED, cluster-wide circuit breaker that, once tripped, rejects every other Polygon caller process-wide for 60s |

### Root cause

`discoverBreakoutSetups`'s Wave-C1 "hybrid intraday breadth refresh" block (gated by the
`BREAKOUT_INTRADAY_REFRESH` env flag — confirmed **live/enabled in production** per
`docs/audit/NIGHTHAWK-MAP.md` §11, a real boto3 read of `blackout-production/app/env`, so this is
not a dormant code path) built its de-duped ticker list (up to `BREAKOUT_INTRADAY_REFRESH_LIMIT` =
40 tickers) and fanned the minute-bar refresh out with a bare, unbounded:

```ts
await Promise.all(
  tickers.map(async (t) => {
    const bars = await minuteFetch(t, today, today).catch(() => []);
    ...
  })
);
```

No local concurrency bound of its own — this relied entirely on the SHARED, cluster-wide reactive
circuit breaker in `src/lib/providers/polygon-rate-limiter.ts` to self-regulate. That breaker opens
after `CIRCUIT_429_THRESHOLD` (5) CONSECUTIVE 429s from ANY caller and then rejects EVERY Polygon
caller process-wide for `CIRCUIT_PAUSE_MS` (60s) — "there is exactly one breaker" per that module's
own header comment. A 40-wide burst from this one call site, landing on top of whatever else
(Vector's bead-recorder sweep, other desks' live reads, swing-discovery's own identical pre-fix fan-
out) is already in flight against the same limiter, is a large enough spike to plausibly trip it on
its own, denying every OTHER Polygon caller in the process for the pause duration regardless of
whether they themselves ever drew a 429.

### This task's origin — already confirmed real twice before this fix

This is the EXACT SAME bug class, in a sibling file, as PR #7832 (merged, `a195fab91`), which fixed
two near-identical unbounded 40-ticker fan-outs in `src/app/api/cron/swing-discovery/route.ts` — one
of which (`fetchIntradayStructureBars`) is itself a *duplicate copy* of this exact
`breakout-discovery.ts` logic (not a shared import), built from the SAME `BREAKOUT_INTRADAY_REFRESH`/
`BREAKOUT_INTRADAY_REFRESH_LIMIT` flag/constant. #7832's own "What was NOT changed" section
explicitly flagged this file as a follow-up:

> `src/lib/zerodte/breakout-discovery.ts` (the 0DTE engine) has a near-identical unbounded
> `Promise.all` fan-out over the SAME `BREAKOUT_INTRADAY_REFRESH`/`BREAKOUT_INTRADAY_REFRESH_LIMIT`
> flag/constant ... noted here for whoever next sweeps 0DTE, but deliberately left untouched.

A sibling agent's own investigation and an adversarial-verify audit pass against `main` both
independently re-confirmed this was still unfixed before this task started. This fix closes that
follow-up.

### Investigating blast radius inside the file — only one genuinely-unbounded fan-out found

Grepped `breakout-discovery.ts` for every `Promise.all`/`Promise.allSettled` to check for a second
instance (swing-discovery's own route.ts had TWO, not one):

1. **The minute-bar refresh above (line ~334 pre-fix)** — genuinely unbounded, up to 40 concurrent
   `fetchStockMinuteBars` calls. **Fixed.**
2. **`fillSide`'s per-ticker chain-build loop (line ~472)** — `for (let i = 0; i < ranked.length...;
   i += BATCH) { ... await Promise.all(batch.map(...)) }` with `BATCH = 8`. Already bounded: this is
   a sequential walk over batches of exactly 8, never more than 8 concurrent `resolveChain`/chain-
   build calls at once. **Not touched** — already correctly bounded, changing it would be scope
   creep.
3. **The long/short `fillSide` pair run together (line ~490)** — `await Promise.all([fillSide(long,
   ...), fillSide(short, ...)])`. Each `fillSide` internally paces at 8-wide (per #2 above), so this
   is two independently-8-bounded pipelines running concurrently (worst case ~16 chain-fetch calls
   in flight), which is the file's pre-existing, deliberate design (the long/short split is itself
   the point — each side independently walks its own ranked pool). **Not touched** — bounded, by
   design, not the bug this task targets.

Only #1 needed the fix.

### Fix

Routed the minute-bar refresh fan-out through `runPolygonPool()` (`src/lib/providers/polygon-rate-
limiter.ts`) — the exact same established, already-unit-tested helper PR #7832 used for
swing-discovery's duplicate copy of this same logic. `runPolygonPool`'s own doc comment already
traces two prior incidents with the identical root cause (`vector-dark-pool-warm` 2026-09-02,
`vector-universe` 2026-09-04) and is already used by `vector-universe.ts`, `polygon-options-gex.ts`,
`heatmap-warm/route.ts`, and now `swing-discovery/route.ts` — reusing it here is the fourth
precedented call site for this exact shape, not a new pattern. Default concurrency
(`POOL_MAX_CONCURRENCY` = 8, env-overridable) matches this same file's own `BATCH = 8` used for the
chain-build fan-out (#2 above), so both of this function's Polygon bursts are now bounded
consistently.

```ts
await runPolygonPool(
  tickers.map((t) => async () => {
    const bars = await minuteFetch(t, today, today).catch(() => []);
    ...
  })
);
```

`runPolygonPool` preserves the same Promise-based return shape (`Promise<T[]>`), so the surrounding
code (building `minuteBars`, calling `buildSessionBarFromMinuteBars`, populating `refreshed`) is
unchanged — only the admission pacing changed, not the data flow.

### Callers — confirmed unaffected

`discoverBreakoutSetups` has exactly one caller, `scan.ts` (`const { discoverBreakoutSetups } =
await import("./breakout-discovery"); const breakoutOutcome = await discoverBreakoutSetups({...})`).
It consumes the discriminated `BreakoutDiscoveryOutcome` return value, which this fix does not
change in shape — `runPolygonPool` is purely an internal pacing change inside the function body, so
`scan.ts` needs no change and was not touched.

### What was NOT changed (deliberately)

- `polygon-rate-limiter.ts`'s shared breaker threshold, pause duration, or mechanism itself — a
  shared, cluster-wide primitive other callers depend on; out of scope here, same as PR #7832.
- The already-documented Polygon/Massive entitlement 403 outage (CLAUDE.md's 2026-11-07/08/09
  notes) — mechanically distinct (a 403 never trips this breaker; `notePolygonOk()` fires on any
  non-429 response) and not fixable from code.
- `fillSide`'s already-bounded 8-wide chain-build batching (#2 above) and the long/short parallel
  pair (#3 above) — verified already correctly bounded; touching either would be scope creep against
  evidence, not a fix.
- The `skip_fetch_failed`/`skip_empty_market` disclosure fix documented in this same file's own
  2026-11-09 header comment (a separate, already-shipped finding about distinguishing a thrown fetch
  from a genuine empty) — pre-existing, unrelated to this fix, left exactly as it was.
- Any discovery/scoring/ranking logic (`rankMoversForChainFetch`, `resolveBreakoutCandidateCap`,
  `classifyContractMiss`) — only the concurrency/pacing of the minute-bar refresh changed; which
  tickers are evaluated, and for what, is untouched. The full pre-existing `breakout-discovery.
  test.ts` suite (20 tests, unchanged) stays green, confirming no behavioral drift.

### Blast radius

Single file, one call site, inside `discoverBreakoutSetups`'s `BREAKOUT_INTRADAY_REFRESH` block.
No change to any exported type or the function's discriminated return shape. `runPolygonPool` itself
is unchanged (reused, not modified), so every one of its existing call sites (`vector-universe.ts`,
`polygon-options-gex.ts`, `heatmap-warm/route.ts`, `swing-discovery/route.ts`) is unaffected.

### Evidence (RED → GREEN)

New regression test file `src/lib/zerodte/breakout-discovery-intraday-refresh-pool.test.ts`
(separate from the existing `breakout-discovery.test.ts` because `BREAKOUT_INTRADAY_REFRESH` is a
module-top-level `const` captured once from `process.env` at import time — exercising the flag-ON
branch needs the env var set before this file's own dynamic `import()` of the module under test, in
a file of its own; `node --test`'s per-file child-process isolation keeps this from leaking into any
other test file). Unlike #7832's source-text assertions (that route needs a full auth/DB/provider
mock harness it doesn't have), this file's existing injectable-deps seam (`BreakoutDiscoveryDeps`,
already used throughout `breakout-discovery.test.ts`) supports a genuine BEHAVIORAL test: a fake
`fetchMinuteBars` records live concurrency (`inFlight`/`maxInFlight`) across 20 queued tickers.

**RED** (confirmed via a plain file-copy backup/restore of `breakout-discovery.ts`, isolating the
fix from the test — per this repo's shared-worktree stash-risk note, no `git stash` used): with the
pre-fix bare `Promise.all` restored, the new test failed —
`AssertionError: minute-bar refresh must never exceed the pool's default concurrency (8); observed
20 concurrent calls out of 20 queued — a bare Promise.all would show 20` — i.e. `maxInFlight` hit
the full ticker count (20), proving the pre-fix code had no bound at all.

**GREEN** (post-fix, restored): the same test observes `maxInFlight <= 8` with all 20 tickers still
processed exactly once each (`totalCalls === 20`, no drops). Full relevant suites also green on Node
20.20.2: the new test file (2/2), `breakout-discovery.test.ts` (20/20, unchanged), `scan.test.ts`,
`polygon-rate-limiter.test.ts`, `vector-universe.test.ts`, `polygon-options-gex.test.ts`,
`swing-discovery/route.test.ts`, `heatmap-warm/route.test.ts` — all passing (194 tests across this
set, 0 fail). `npx tsc --noEmit` clean. Full `npm test` — see the PR for the final count.
