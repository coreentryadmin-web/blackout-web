> **kind:** `FINDING`

## 0DTE gate-calibration `days=N` window was silently ignored past ~14 days — `fetchGradedSkips` capped at a flat 2000 rows regardless of the requested window — FIXED

| | |
|---|---|
| **Area** | 0DTE — gate-calibration evidence loop (`GET /api/market/zerodte/calibration`, `skip-grading.ts`) |
| **Severity** | P1 (the primary evidence source for whether a hard gate is well-calibrated silently returned stale/wrong data for every window wider than ~2 weeks, undermining several gate-floor re-checks flagged the same day) |
| **Status** | FIXED |
| **Files** | `src/lib/zerodte/skip-grading.ts`, `src/lib/zerodte/calibration.ts`, `src/lib/zerodte/skip-grading.test.ts`, `src/lib/zerodte/calibration.test.ts` |

### Root cause

Found while executing the TOP-3 action items from today's 0DTE gate-floor deep-dive (a 12-agent
parallel audit of every hard-gate floor in `evaluateZeroDteGates`). Item #1 was to re-run
`scripts/audit/zerodte-gate-primary-ablation.mjs --days=90` and watch G-13
(`flow_accumulation_conflict`) as more rejections accrued — its only real outcome measurement had
flagged a concerning wrong-direction signal (BLOCKED n=12, WR=75.0% vs. a 30.8% passed baseline).

Three consecutive re-runs of that exact same command, ~10-20 minutes apart, produced wildly
different results for the same gate over the same nominal 90-day window:

| Run | G-13 blocked n | G-13 blocked WR |
|---|---|---|
| Workflow's earlier run (same session) | 12 | 75.0% |
| Re-run #1 | 10 | 70.0% |
| Re-run #2 | 5 | 40.0% |

A direct, isolated check (two back-to-back `GET /api/market/zerodte/calibration?days=90` calls,
no backfill in between) confirmed the *current* number (n=5) is itself stable and reproducible —
so the instability came from the read, not from randomness inside a single request. Sweeping
`days=7/14/30/60/90` against the live endpoint made the mechanism obvious:

```
days=7:  sum(n)=718  sum(ungradeable)=185  total=903
days=14: sum(n)=1777 sum(ungradeable)=223  total=2000
days=30: sum(n)=1777 sum(ungradeable)=223  total=2000
days=60: sum(n)=1777 sum(ungradeable)=223  total=2000
days=90: sum(n)=1777 sum(ungradeable)=223  total=2000
```

`days=14/30/60/90` all returned the **byte-identical** total (2000, split 1777/223) — proof the
90-day window was reading exactly the same rows a 14-day window already saw, nothing more.

`buildZeroDteCalibrationReport` (`calibration.ts`) calls `skipMod.fetchGradedSkips({ sinceYmd,
throughYmd })` with **no `limit`**, so it fell through to `fetchGradedSkips`'s own hardcoded
clamp:

```ts
// old:
LIMIT $3`,
  [opts.sinceYmd, opts.throughYmd, Math.min(2000, Math.max(1, opts.limit ?? 2000))]
```

`fetchGradedSkips` orders `ORDER BY observed_at DESC LIMIT 2000` — the most recent 2000
graded/ungradeable rejection rows, full stop, regardless of what `since`/`through` (derived from
`days`) actually asked for. Live volume is already ~2000 rows inside 14 days alone
(~140+/day), so every window request wider than ~14 days was silently truncated back down to that
same most-recent slice — the `since`/`through` date filter in the SQL was real, but functionally
moot once the row volume in range exceeded the LIMIT. As the ongoing skip-grading backfill (this
session's own re-runs, plus the daily `zerodte-skip-grade` cron) graded MORE of the backlog over
time, the "most recent 2000" window's leading edge kept moving forward, silently pushing
*older* graded rows for low-volume gates like G-13 out of view — which is exactly why G-13's
reported n dropped run over run (12 → 10 → 5) even though nothing was ever deleted from the DB.

### Why it wasn't caught earlier

`fetchGradedSkips`'s SQL is deterministic and correct in isolation (confirmed: two calls 3 seconds
apart with no backfill between them returned byte-identical results). The bug only surfaces as a
*window* defect — comparing `days=N` against `days=M` — which nothing in the existing toolkit did
before today; every prior script that reads `blocked_value` (`zerodte-gate-primary-ablation.mjs`,
`gate-calibration-live-report.mjs`) ran with a single fixed `--days` value per invocation and
reported whatever came back as if it were the full requested window. `platform_wide_skip_grading_health`
even reports `total_graded`/`total_ungradeable` that sum to exactly the LIMIT (1777+223=2000) with
no `truncated` flag or `total_available` count to signal the read was capped.

### Blast radius

Every consumer of `GET /api/market/zerodte/calibration`'s `blocked_value` field for any window
request wider than the live "most recent ~14 days" boundary: `scripts/audit/zerodte-gate-primary-ablation.mjs`,
`scripts/audit/gate-calibration-live-report.mjs`, and any `docs/audit/*.md` write-up citing a
`--days=90`/`--days=60`/`--days=30` blocked-value figure as if it covered that full window. This
does **not** affect the separate, direct-derivation backtests that don't go through this route
(e.g. `zerodte-score-floor-outcome-backtest.mjs`, which re-derives scores from `deriveZeroDteSetups`
directly rather than reading `blocked_value`). `fetchGradedSkips` has exactly one production caller
(`buildZeroDteCalibrationReport`), confirmed by a repo-wide grep — so the fix's blast radius is
fully scoped to that one call path.

### Fix

Raised `fetchGradedSkips`'s internal safety ceiling from a flat `2000` to a named
`MAX_GRADED_SKIPS_LIMIT = 30_000` (still bounded, now with real headroom above observed volume),
and changed `buildZeroDteCalibrationReport` to pass an explicit `limit` **scaled to the requested
window** (`days * GRADED_SKIPS_PER_DAY_BUDGET`, budget=300/day — comfortably above the ~140+/day
currently observed) instead of relying on `fetchGradedSkips`'s bare default. This mirrors the exact
pattern already used one line above in the same function for the committed-ledger fetch
(`Math.min(MAX_LEDGER_ROWS, days * 20)`) — that pattern just wasn't applied to the graded-skips
fetch, which turned out to need a much larger per-day budget given its far higher row density.
Callers that don't pass a `limit` (none exist in production today) keep the historical default of
2000, so this is purely additive for the one call site that needed it.

### What was deliberately left alone

Did not add a `truncated`/`total_available` disclosure field to the API response — that would be a
useful follow-up but is a separate, additive change or transparency, not required to fix the actual
defect (the window now genuinely covers what it claims to, at current observed volume). Did not
touch any gate threshold or the score-floor/confluence-floor re-check plan from today's gate-floor
audit — this is a data-pipeline correctness fix, not a calibration decision.

### Regression test

`skip-grading.test.ts`: `fetchGradedSkips` now asserts a wide caller-supplied `limit` (27,000)
reaches the SQL `LIMIT` parameter unclamped, that an even larger request (999,999) is still capped
at `MAX_GRADED_SKIPS_LIMIT`, and that an unspecified `limit` keeps the historical default (2000).
`calibration.test.ts`: a source-text assertion (same idiom `skip-grading.test.ts` already uses for
an order-of-operations invariant `buildZeroDteCalibrationReport` has no DB-mock harness to test
behaviorally) pins that the `fetchGradedSkips` call site passes `limit: days *
GRADED_SKIPS_PER_DAY_BUDGET`, never a bare call — the exact shape of this bug. RED→GREEN proven via
`git stash` on the two source files only (2 tests fail pre-fix: the behavioral limit-clamp test and
the source-text call-site test; 0 fail post-fix, 65/65 in both files combined). Full `tsc --noEmit`
clean. Full `npm test` on Node 20: 14464 pass / 0 fail / 3 skipped (unchanged skip count from
before this change).

### Live re-verification

Re-ran the direct `days=7/14/30/60/90` sweep is not repeatable against production until this fix
deploys (the fix is code, not yet live) — flagged in `docs/audit/MARKET-OPEN-VALIDATION.md` for
next-session confirmation that a post-deploy `days=90` calibration read genuinely differs from
`days=14` at current volume, and that `zerodte-gate-primary-ablation.mjs --days=90` re-run against
the fixed endpoint gives a STABLE G-13 (and every other gate's) blocked-n across repeated calls
within the same session.
