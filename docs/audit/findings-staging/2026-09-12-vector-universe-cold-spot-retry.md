# Vector universe snapshot served `spot:null` for 35 of 64 rows — every one a static-allowlist name outside the UI preset chips

> **kind:** FINDING

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 (data correctness — Vector scanner + Largo's Vector tool both read this snapshot) |
| **Area** | Vector — `src/features/vector/lib/vector-universe.ts` (`buildVectorUniverseSnapshot`) |
| **Found by** | Standing performance/latency + 5-engine live monitor sweep (Vector health check) |

## Symptom

Live `GET /api/market/vector/universe` (2026-09-12) served `spot: null` for **35 of 64 rows**, on
a build that `isCompleteBuild` (`attempted === produced`) reports as COMPLETE. All 35 null names
are on the STATIC allowlist (`HEATMAP_EXTRA_LIQUID_TICKERS` in `heatmap-allowlist.ts`) — GOOG, BAC,
GS, INTC, ORCL, TSM, UNH, V, COIN, ABBV, ANET, ARM, ASTS, BA, COP, CVX, GILD, GLD, HOOD, IBIT,
LUNR, MARA, MRK, MS, OXY, PL, PLTR, RIOT, RKLB, SLB, SMH, VRT, XOM — none of them one of the ~11
UI preset chips (`HEATMAP_PRESET_TICKERS`: SPY/SPX/QQQ/IWM/NVDA/TSLA/AAPL/AMD/META/AMZN/GOOGL),
every one of which resolved fine.

## Root cause

`fetchGexHeatmap`'s cold/inflight build is capped at `gexHeatmapMaxBlockMs` (default 3s) before
handing off stale-or-null — correct for a LIVE member request (better to answer fast with stale
data than hold an HTTP request open), but `buildVectorUniverseSnapshot` (the 5-min recorder cron,
`src/app/api/cron/vector-universe-snapshot/route.ts`, `maxDuration=180`, dispatched fire-and-forget
via `after()`) shares the exact same function and the exact same 3s cap even though nothing is
waiting on it in real time.

The 11 UI preset chips get real, continuous member-view traffic (Vector/Thermal/Helix/Largo tool
calls), which keeps their `fetchGexHeatmap` cache warm between cron ticks. The extended allowlist
names are NOT UI preset chips — nobody clicks them directly — so the cron's own 5-min tick is
usually the ONLY thing asking for them, and several (GOOG, TSM, ORCL, ...) carry deep, many-expiry
chains (GOOG: 100+ strikes across 15 expiries) that can take longer than 3s to build from scratch.
A cold tick for one of these times out on ITS OWN FIRST CALL — no pool contention with siblings
required, confirmed by a solo sequential probe (see Evidence) — and comes back with no `asof`, so
the row lands as `spot: null`, `asOf: null`.

`isCompleteBuild` only checks whether every ticker produced A row (`attempted >= produced`); it has
no way to see that a produced row's price never resolved. So a build that is "complete" by that
metric can still replace the whole snapshot with a majority-null one for these names, and — because
the build genuinely doesn't miss any ticker's *slot* — the merge-vs-replace logic in
`vector-universe-merge.ts` (built for the opposite failure, a build that drops rows outright) never
engages to protect a previously-good row.

## Evidence (live production, 2026-09-12, off-hours)

```
GET /api/market/vector/universe  →  updatedAt staleness ~9-12min (last real RTH cron tick),
  attempted: 64, produced: 64 (isCompleteBuild says COMPLETE), 35/64 rows spot:null
```

Direct, uncontended, SEQUENTIAL solo probes (not concurrent — ruling out fresh pool contention)
against `GET /api/market/gex-heatmap?ticker=<T>` for several of the null names:

```
GOOG: first call  → available:false, spot:undefined, asof:undefined
GOOG: retry ~4s later → available:true,  spot:335.38, asof:2026-09-12T18:44:24.353Z
BAC:  first call  → available:false
BAC:  retry ~4s later → available:true,  spot:62.72
COIN: first call  → available:false
COIN: retry ~4s later → available:true,  spot:174.98
```

The build that missed the 3s cap keeps running in the background (`heatmapInflight` is a shared,
not-cancelled promise per `polygon-options-gex.ts`) and finishes moments later — the data was never
actually unavailable, only slower than the live-request-tuned cap.

`docs/audit/RUN-LOG.md`/CloudWatch confirms the cron itself runs cleanly on schedule during real
RTH (2026-09-11: `rows=79-84`, `elapsed=529ms-22342ms`, zero `[vector-universe] incomplete build`
warnings in the last 4 days) — the defect is entirely inside a "complete" build, not a missed or
crashed cron run.

## Fix

Added `retryNullSpotRows` in `vector-universe.ts`: after the main bounded pooled fan-out
(`runPolygonPool`, concurrency 8) completes, re-attempt — through the SAME bounded pool — only the
rows whose `spot` came back null. By the time a full pass across the whole universe (~64-100
tickers) has run, the earlier ticker's own background build has very likely already finished and
warmed the cache, so the retry is normally a cheap cache read, not a second cold build. A row that
resolves on retry replaces the original; a genuinely, permanently unresolvable ticker (dead/typo,
no real chain) just retries to another null and is left exactly as first-built — never corrupted.

Deliberately did **not** touch `fetchGexHeatmap`/`gexHeatmapMaxBlockMs` (the shared, widely-used
provider function every desk reads — Thermal, Helix, Largo's `get_gex_heatmap` tool, the canonical
`/api/market/gex-heatmap` route, and the live member-facing Vector chart all call it). Loosening
its 3s live-request cap to help a background cron would risk making a LIVE member request hold
open longer on a cold ticker — a strictly worse trade for the interactive path this cap protects.
The retry lives entirely in Vector-universe-only code and costs nothing on the common (already-warm)
path.

`recordWallHistory` is deliberately NOT re-applied on the retry pass — this only refreshes the
row's displayed price fields (`spot`/`gammaFlip`/`vexFlip`/wall levels), not the bead-rail sample
for that specific 5-min tick; a missed bead sample is a much smaller, self-healing gap (the next
tick records again) and re-recording here risked a duplicate/out-of-bucket write.

## Tests

`src/features/vector/lib/vector-universe.test.ts`:
- new `SLOWCOLD` fixture (call-counter mock: first `fetchGexHeatmap` call returns `null`, every
  subsequent call resolves with a real spot) — `"buildVectorUniverseSnapshot: retries a ticker
  whose first attempt missed the cold-build block cap"` asserts the retry pass picks up the
  resolved spot and that the ticker was actually fetched twice.
- `"buildVectorUniverseSnapshot: a permanently-unresolvable ticker still fail-closes after the
  retry pass"` — reuses the existing deterministic `NOSPOT` fixture (always null) to prove the
  retry never corrupts a genuinely dead ticker's row (still `spot: null`, still fail-closed GEX
  walls) even though it IS re-attempted.

RED confirmed via `git stash` on `vector-universe.ts` only (keeping the two new tests): 2/16
failing → 16/16 after restoring the fix. Full `npm test` (Node 20.20.2): **13964 pass / 0 fail / 3
skipped.** `npx tsc --noEmit` clean.

## Blast radius

Single file (`vector-universe.ts`), one new module-private helper (`retryNullSpotRows`), called
from the one existing build path (`buildVectorUniverseSnapshot`) shared by both the RTH cron and
the inline scanner-poll rebuild — both benefit identically. No change to `fetchGexHeatmap`, the
merge-vs-replace logic in `vector-universe-merge.ts`, or any other consumer.
