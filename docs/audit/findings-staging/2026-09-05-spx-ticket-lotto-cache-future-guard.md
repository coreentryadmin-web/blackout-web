> **kind:** FINDING

# SPX graded + lotto ticket in-process caches treated future `at` as fresh — FIXED

| **Status** | FIXED |
|------------|-------|
| **Pri** | P2 |
| **Area** | SPX play ticket selection — in-process cache freshness |

## Symptom

Pattern-scan follow-up to the standing cache-freshness sweep (#3834, #3844, #3846, #3849):
`pickChainContract()` and `pickLottoChainContract()` each keep a module-level in-process
ticket cache keyed by spot/direction/grade (45s / 60s TTL). Both gates used raw
`now - entry.at < ttlMs`, which treats a clock-skewed future `at` stamp as age 0 → infinitely
fresh → stale chain quotes can block a play open until process restart.

## Root cause

Same unclamped age comparison fixed across quote routes, gex-heatmap overlays, VIX IV rank,
and SPX ODTE UW ladder caches — these two ticket caches were missed.

## Fix

Route both through `isWsUpdatedAtFresh(at, ttlMs, now)` (5s future tolerance, shared contract).

## Evidence

- `src/features/spx/lib/spx-play-ticket-cache-freshness.test.ts`
- `src/features/spx/lib/spx-lotto-ticket-cache-freshness.test.ts`
- `npx tsx --test` on both files: 2/2 pass (Node 20)

## Blast radius

`spx-play-options.ts` (graded ticket path only — quote cache was already guarded) and
`spx-lotto-options.ts`. No API/schema change; only when a skewed `at` would have incorrectly
hit cache.
