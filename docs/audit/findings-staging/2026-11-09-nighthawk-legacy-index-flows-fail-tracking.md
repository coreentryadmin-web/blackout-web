# 2026-11-09: Night Hawk Legacy's `index_flows` UW pull has no fail-tracking — a real outage on every tracked index ETF reads identically to a flat tape

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

`fetchIndexFlowsPooled()` (`src/features/nighthawk/lib/market-wide.ts`) fetches each of the 10
`INDEX_TICKERS` (GLD, IWM, QQQ, SMH, SPY, TLT, XBI, XLE, XLF, XLK — `constants.ts`) via
`fetchUwTickerFlowAlerts(t, 30).catch(() => [])`, with **no fail-tracking flag of any kind**. A
genuine UW upstream outage and a genuinely-flat tape both collapsed to the identical per-ticker
shape `{alerts:0, call_premium:0, put_premium:0, total_premium:0}` — nothing distinguished "UW
outage" from "quiet tape", the exact absence-vs-failure conflation
`docs/audit/LARGO-PRODUCT-CONTRACT.md`'s absence principle exists to prevent.

This is the sibling of a bug fixed earlier the same day in #7745 (`dc67e3bfa`) for the **7**
discovery lanes `extractMultiSourceCandidates` (`candidates.ts`) reads for the Night Hawk Legacy
candidate pool — but `index_flows` is a different lane entirely (it feeds `fetchIndexDossiers`'
index/sector dossiers, not the stock-candidate pool) and #7745 never touched
`fetchIndexFlowsPooled`/`index-dossier.ts` (confirmed via `git show dc67e3bfa`).

### Concrete, measurable downstream consequence

`fetchIndexDossiers()` (`src/features/nighthawk/lib/index-dossier.ts`) reads
`ctx.index_flows[ticker].total_premium` and does `if (total < minPremium) continue` (default
`minPremium=100_000`) — a silently-zeroed `index_flows` entry drops that ETF's index dossier from
the published edition exactly as if there were genuinely no flow, with the omission itself
unmarked. `edition-builder.ts` calls `fetchIndexDossiers(ctx)` at two call sites (the recap-only
path, wrapped in its own `.catch(() => [])` that would swallow even a function-level throw; and the
full-synthesis path, unwrapped).

Live evidence (same-day audit): a real authenticated `GET /api/market/nighthawk/edition` call
returned `index_flows` with **all 10** tracked ETFs simultaneously at `alerts:0, total_premium:0`,
and `index_dossiers: []`. A healthy edition normally carries ~6 index/sector dossiers (per a prior
`FINDINGS.md` entry) — going from 6 to 0 while every tracked index ETF reads exactly $0/0-alerts
simultaneously is the signature of a shared-upstream read failure, not 10 independently-quiet names
(SPY/QQQ essentially always have real flagged premium in any 30-day window).

## Root cause

`fetchUwTickerFlowAlerts` (and the function it wraps, `fetchUwTickerFlowAlertsWithRaw`) inherit
`uwGetSafe`'s deliberate "never throw" contract: UW not configured, the circuit breaker open with
no stale cache, a 403, or an exhausted-retries 429/5xx/network blip ALL resolve to the identical
`null`. `extractRows(null)` is `[]` — the exact same empty array a genuinely-answered,
genuinely-quiet ticker produces. Because `fetchUwTickerFlowAlerts` therefore **never rejects**, the
`.catch(() => [])` wrapped around it in `fetchIndexFlowsPooled` could structurally never fire — it
was dead code from the moment it was written. This is a different, deeper collapse than the one
#7745 fixed: #7745's six lanes go through fetchers (`fetchUwMarketOiChange`,
`fetchUwUnusualTrades`, `fetchBenzingaAfterHoursMovers`, `fetchUwPredictionsConsensus`,
`fetchMarketMovers`, `fetchDailyMarketSummary`) where a `.catch()` CAN legitimately fire — some of
those also sit on top of `uwGetSafe` internally and may have the same latent issue, but that is a
pre-existing, out-of-scope question for a different PR, not something this fix touches or relies on
being true or false.

The repo already has a working precedent for exactly this distinction: `fetchUwDarkPool` (same
file, `unusual-whales.ts`) guards `if (data == null) return null;` **before** calling
`extractRows(data)`, with its own doc explaining why (a cached false "no large dark pool prints
today" from a call that never actually got an answer). This fix applies the identical guard to the
per-ticker flow-alerts lane.

## Fix

1. **`unusual-whales.ts`**: added `fetchUwTickerFlowAlertsResult(ticker, limit)`, a sibling of the
   existing `fetchUwTickerFlowAlerts`/`fetchUwTickerFlowAlertsWithRaw` that calls `uwGetSafe`
   directly and returns `{ alerts, failed }`, where `failed = data == null` — the same
   distinguishing signal `fetchUwDarkPool` already uses. The two existing functions are left
   completely unchanged (same signature, same non-nullable-array contract) so their other callers
   (`largo/run-tool.ts`, `spx-desk.ts`) are unaffected.
2. **`market-wide.ts`**: `fetchIndexFlowsPooled` now calls `fetchUwTickerFlowAlertsResult` instead
   of `fetchUwTickerFlowAlerts(...).catch(() => [])`, and returns `{ flows, failed }` — `failed` is
   true when **any** of the 10 per-ticker pulls genuinely failed (one lane-wide flag, matching the
   #7745 pattern's "one flag per lane" granularity, and matching the live symptom, where an
   upstream outage hit every tracked ETF at once because they share one upstream endpoint shape).
   `MarketWideContext` gains a new optional `index_flows_fetch_failed` field, set from this result
   (and from the outer `.catch()` around `fetchIndexFlowsPooled()` itself, treated as a failure
   too).
3. **`edition-builder.ts`**: both `market_recap` construction sites (recap-only path and the full
   published-edition path) now carry `index_flows_fetch_failed: ctx.index_flows_fetch_failed ??
   false` alongside the existing `index_flows`/`index_dossiers` fields. This makes the flag
   actually observable: it reaches the persisted edition row directly (ops/admin reading the row),
   and it automatically reaches Largo's model-facing payload too — `compactNightHawkEditionForModel`
   (`nighthawk-edition-for-model.ts`) passes through every `market_recap` key not in
   `DELEGATED_RECAP_BLOBS` unchanged, so no change was needed there for the flag to surface to the
   model.

### Why not wire this into `alertRecapOnlyIfAnomalous`/`anyDiscoveryLaneFetchFailed` (the #7745 mechanism)

That mechanism's `benign` check is specifically gated on `funnel.candidates === 0` — it is about
whether the **stock-candidate pool** (the 7 lanes in `candidates.ts`) came back empty for a
benign-vs-anomalous reason. `index_flows`/`index_dossiers` are a completely separate output (index
ETF context for the recap, never part of the candidate pool), and their emptiness has nothing to do
with `funnel.candidates`. Folding `index_flows_fetch_failed` into that specific gate would be
incorrect — it would fire the "zero candidates" ops alert over an index-dossier-only problem, or
conversely never fire if candidates happen to be nonzero that night even though the index-flows
lane failed. Surfacing it directly on the edition's own `market_recap` (next to the data it
qualifies) is the correct, scoped place for this particular absence-disclosure.

### Why `uwGetSafe` returning `null` (not a count of real-looking-but-wrong alerts) is the right signal

`uwGetSafe`'s success path returns `uwGet`'s raw parsed JSON body verbatim — an array, an object,
even `{}` — never `null`. `null` is produced only by the explicit failure branches (UW not
configured, circuit open with no stale cache, 403 PLAN_BLOCKED, or retries/budget exhausted on
429/5xx/network blips). So `data == null` is the one value the success path cannot produce,
making it a clean, non-overlapping failure signal rather than a heuristic derived from the
already-collapsed `alerts` array (e.g. `alerts.length === 0`, which would just re-create the exact
bug being fixed).

## Blast radius

- `MarketWideContext` gains one new optional boolean field (`index_flows_fetch_failed`) —
  additive, no existing field renamed or removed, so every existing consumer (including any
  fixture/test building a `MarketWideContext` literal) is unaffected.
- `unusual-whales.ts` gains one new exported function (`fetchUwTickerFlowAlertsResult`) — purely
  additive; `fetchUwTickerFlowAlerts`/`fetchUwTickerFlowAlertsWithRaw` and all of their existing
  call sites (`largo/run-tool.ts`, `spx-desk.ts`) are untouched.
- `edition-builder.ts`'s two `market_recap` objects each gain one new key. `JSON.stringify`'d size
  impact is negligible (`"index_flows_fetch_failed":false` is ~30 bytes) — verified the existing
  `nighthawk-edition-for-model.test.ts` "fits inside the transport cap" test still passes.
- **Deliberately left unscoped**: the other UW reads inside `fetchMarketWideContext` that also sit
  on top of `uwGetSafe` and may have the identical collapse — `tide` (`fetchUwMarketTide`),
  `sector_tides`/`etf_tides` (`fetchUwSectorTide`/`fetchUwEtfTide`), `mag7_greek_flow`
  (`fetchUwGroupGreekFlow`), `macro_indicators` (`fetchUwMacroIndicators`), `vix_iv_rank`
  (`fetchVixIvRankPercentile`), `total_options_volume` (`fetchUwMarketTotalOptionsVolume`), and
  `top_net_impact` (`fetchUwMarketTopNetImpact`) — are out of scope for this single-issue fix, as
  are the two #7745-added flags (`oi_change_fetch_failed`, `unusual_trades_fetch_failed`) whose own
  underlying fetchers (`fetchUwMarketOiChange`, `fetchUwUnusualTrades`) ALSO sit on top of
  `uwGetSafe` and may share the same latent "never actually throws" issue — noted here for a future
  pass, not touched by this PR.

## Evidence (RED → GREEN)

New tests:
- `src/lib/providers/unusual-whales.test.ts` — 3 new tests for `fetchUwTickerFlowAlertsResult`:
  `failed:true` on a 403 (no alerts parsed), `failed:false` on a genuine 200-with-zero-rows answer,
  and a source guard proving `failed` is derived from `data == null`, not re-derived from the
  post-`extractRows` `alerts` array.
- `src/features/nighthawk/lib/market-wide.test.ts` (new file) — 3 new tests for
  `fetchIndexFlowsPooled` (now exported): `failed:true` when every tracked ETF's own pull 403s
  (while the per-ticker rows still shape to `alerts:0, total_premium:0` — the exact live symptom),
  `failed:false` when UW genuinely answers "zero alerts" for every ticker, and `failed:true` when
  only ONE of the ten tickers fails (proving the lane-wide flag catches a partial outage, not just
  a total one).

RED (pre-fix, via `git stash push -u -- src/lib/providers/unusual-whales.ts
src/features/nighthawk/lib/market-wide.ts src/features/nighthawk/lib/edition-builder.ts`, new test
files left in place):
`npx tsx --experimental-test-module-mocks --test src/features/nighthawk/lib/market-wide.test.ts
src/lib/providers/unusual-whales.test.ts` → **40 pass / 6 fail**. The 3 new
`unusual-whales.test.ts` tests failed with `fetchUwTickerFlowAlertsResult is not a function`
(the pre-fix file has no such export). The 3 new `market-wide.test.ts` tests failed the same
way, transitively, because `market-wide.ts` pre-fix both lacks the `fetchIndexFlowsPooled` export
and imports the now-nonexistent `fetchUwTickerFlowAlertsResult`.

GREEN (`git stash apply` to restore the fix, then dropped the stash): same command →
**46/46 pass**.

Combined regression run alongside sibling suites (`edition-funnel.test.ts`,
`edition-builder-zero-candidates-funnel.test.ts`, `edition-builder-after-hours-sanitize.test.ts`,
`edition-builder-dossier-fetch-retry.test.ts`, `edition-builder-scoring-history.test.ts`,
`edition-builder-scoring-snapshot.test.ts`, `resolve-edition.test.ts`,
`nighthawk-edition-for-model.test.ts`, `candidates.test.ts`, `dossier.test.ts`): **108/108 pass**.

`npx tsc --noEmit` (Node 20): clean (empty output, exit 0).

Full suite (`npm test`, Node 20): see PR for the exact pass count.
