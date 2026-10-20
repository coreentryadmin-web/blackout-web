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
  reported as a finding — caught before trusting it) is DISCARDED, not reported. Re-run with the
  fix — see the companion finding for the result.
- `zerodte-missed-trades-tracker.mjs`: this script's own prior-round result (§D of this round's
  main report / `docs/audit/FINDINGS.md`'s "Corrected FLOW missed-trade rate, larger sample"
  section, 15-session-day window 2026-09-29…2026-10-19) IS materially affected — re-run with the
  exact same window and the fix in place.

### CONFIRMED CORRECTION — the previously-reported missed-trade rate understated the real number

| | TRAIN (8 days) — before → after fix | VALIDATION (7 days) — before → after fix |
|---|---|---|
| COMMITTED n / win rate | 2 / 0.0% → **3 / 33.3%** | 2 / 50.0% → **4 / 25.0%** |
| BLOCKED n | 55 → 57 | 55 → 55 |
| **MISSED TRADES (blocked, would have WON)** | **25.5% (14/55) → 43.9% (25/57)** | **29.1% (16/55) → 49.1% (27/55)** |
| FALSE ALERTS (committed, real loss) | — → 66.7% (2/3) | — → 75.0% (3/4) |

**The real missed-trade rate is roughly DOUBLE what the stale-dte bug reported** — both halves
moved in the same direction by a similar magnitude (TRAIN +18.4pp, VALIDATION +20.0pp), so this is
not a TRAIN-only artifact. `score_floor` remains the dominant, broadly-indiscriminate blocker in
BOTH halves under the fix too (TRAIN: 20/25 missed winners, 31/32 correctly-avoided losers;
VALIDATION: 26/27 missed winners, 28/28 correctly-avoided losers) — the qualitative conclusion
("score_floor blocks almost everything near the margin, not selectively") is UNCHANGED, but the
quantitative missed-trade rate this round's main report quoted (~26-29%) was understated and
should be read as ~44-49% going forward. COMMITTED win rate also moved (both halves now show a
real majority of committed plays as false alerts: 66.7%/75.0%), though that population remains
thin (n=3/4) and was already flagged as too thin to trust in the original report.

**No gate changed on this corrected evidence either** — the correction makes the case for a
real-cost review of `score_floor` specifically stronger, not weaker, but still does not by itself
justify loosening it (same standing discipline as every other finding this round).

**NOT affected**: `zerodte-swift-comparison.mjs` (uses `tier-export`/`rejection-export`/Polygon
only, no flow-history store), `zerodte-thesis-rank-reject-real-cost-ab.mjs` and
`thesis-rank-reject-outcome-ab.mjs` (BREAKOUT/BREAKDOWN screen via grouped-daily bars, not UW
flow alerts), `zerodte-gate-compound-funnel.mjs` and `zerodte-rvol-*` scripts (live-only UW
fetch, no local-history consumption), and every score_floor/RVOL-universe/other finding from this
round that didn't touch this loader.

### Blast radius (code)

One shared loader fixed (`scripts/audit/lib/zerodte-flow-history.mjs`), zero production code
touched — this is audit-tooling-only, no gate/filter/exit rule in the live trading path changed.
