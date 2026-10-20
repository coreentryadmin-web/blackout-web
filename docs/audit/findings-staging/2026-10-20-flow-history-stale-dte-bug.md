## 2026-10-20 — [FINDING, P1 Night Hawk 0DTE, tooling] Local flow-history store's persisted `dte` was computed at COLLECTION time, not alert time — corrupted every multi-day replay backtest that used it — FIXED

> **kind:** `FINDING`

| **Status** | FIXED (root cause in shared loader, both consuming scripts now correct) |
|---|---|

**Context.** Caught live while building `zerodte-min-dominance-real-cost-ab.mjs` (this round's
follow-up to the real Swift comparison, see the companion finding). A sanity check on the real
candidate population for 2026-09-09 showed every graded candidate carrying an implausible expiry
(`2026-10-23`, constant across multiple different session days) — the kind of "too consistent to
be real" signal this toolkit's own standing discipline says to check before trusting a result.

### Root cause

`zerodte-history-collect.mjs` persists each flow alert's `dte` via `dteFromExpiry(f.expiry)` —
which defaults its `nowMs` parameter to `Date.now()`, i.e. the COLLECTOR'S OWN run-time "today",
not the alert's own `alerted_at` date. Every consuming replay script then reads that **stale**
`dte` field directly and passes it straight into the REAL, unmodified `deriveZeroDteSetups`
(board.ts), whose own evidence-gate filter is `dte == null || dte > SETUP_MAX_DTE(4) || dte < 0`
→ skip. For any session day other than the exact day the collector last ran, that filter was
therefore evaluating the WRONG number.

**Measured on a real file** (`docs/audit/history/zerodte-flow/2026-09-09.json`, 1296 real rows):
stored `dte` ranged from **-40 to +11** (correct only for a "today" near the collector's actual
run date, weeks later than 2026-09-09). Only 13 rows had a stored `dte` of exactly 4 (the only
value `<= SETUP_MAX_DTE` and `>= 0` in the whole file) — and those 13 were THEMSELVES wrong: they
passed the filter purely because their REAL expiry happened to land ~4 calendar days after
collection time, by coincidence, not because they were anywhere near 0DTE on 2026-09-09. Every
alert whose REAL expiry WAS 2026-09-09 (true dte=0 that day) carried a stored dte around -40 and
was silently excluded.

### Fix

`zerodte-flow-history.mjs`'s shared `loadHistoricalFlowDays()` now recomputes `dte` fresh on
every load, anchored to EACH ROW'S OWN `alerted_at` (`dteFromExpiry`'s existing, already-exposed
`nowMs` parameter — no new math, just supplying the right anchor). Fixed at the loader, the single
shared choke point, so both consuming scripts (`zerodte-missed-trades-tracker.mjs`,
`zerodte-min-dominance-real-cost-ab.mjs`) get the fix automatically with no call-site change.
**Verified on the same file**: recomputed `dte` distribution is now 0/1/2/5/6/7/8/9/12/13/14/16/...
— 80 real rows at dte=0, 18 at dte=1, 155 at dte=2 (a materially larger and categorically
different 0DTE-eligible population than the previous 13 spurious matches).

### Blast radius — what this invalidates and what it doesn't

Only scripts that call `loadHistoricalFlowDays` for a MULTI-DAY point-in-time replay are affected
— confirmed via `grep -rl loadHistoricalFlowDays scripts/audit/*.mjs`, exactly two:
- `zerodte-min-dominance-real-cost-ab.mjs` (this round, new): its first 40-day run (never
  reported as a finding — caught before trusting it) is DISCARDED, not reported. Re-running now
  with the fix.
- `zerodte-missed-trades-tracker.mjs`: this script's own prior-round result (§D of this round's
  main report, "missed-trade rate cross-validates at ~26-29%", 15-session-day window
  2026-09-29…2026-10-19) is POTENTIALLY affected for any day in that window far enough from when
  the collector was actually run — re-running now to measure the real delta, correction to follow
  in a separate finding if the numbers move materially.

**NOT affected**: `zerodte-swift-comparison.mjs` (uses `tier-export`/`rejection-export`/Polygon
only, no flow-history store), `zerodte-thesis-rank-reject-real-cost-ab.mjs` and
`thesis-rank-reject-outcome-ab.mjs` (BREAKOUT/BREAKDOWN screen via grouped-daily bars, not UW
flow alerts), `zerodte-gate-compound-funnel.mjs` and `zerodte-rvol-*` scripts (live-only UW
fetch, no local-history consumption), and every score_floor/RVOL-universe/other finding from this
round that didn't touch this loader.

### Blast radius (code)

One shared loader fixed (`scripts/audit/lib/zerodte-flow-history.mjs`), zero production code
touched — this is audit-tooling-only, no gate/filter/exit rule in the live trading path changed.
