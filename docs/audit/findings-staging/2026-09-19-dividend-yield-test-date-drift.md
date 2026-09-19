> **kind:** `FINDING`

## Dividend-yield ETF-fallback test used the real clock against calendar-fixed fixture dates — drifted false-red on 2026-09-19

| | |
|---|---|
| **Area** | `src/lib/providers/polygon-options-gex.test.ts` — `dividend-yield resolve falls back to trailing dividends when ratios has no row (ETF)` |
| **Severity** | P3 — CI-flake-shaped test bug, not a product defect. Real risk: it silently regressed a genuinely unrelated PR's `verify` check. |
| **Status** | FIXED — `fix/dividend-yield-test-date-drift` |
| **Found by** | Investigating a red `verify` on PR #5238 (cross-desk-coaching fix) — the failure was unrelated to that PR's diff, root-caused per the standing CI-red protocol. |

### Root cause

`resolveHeatmapDividendYieldUncached` (`polygon-options-gex.ts`) calls
`trailingTwelveMonthDividendYield(dividends, spot, Date.now())` — the REAL current time, not an
injectable one. The test built its fixture dividend rows against a comment-only "2026-08-28 now"
assumption (one row, `2025-09-19`, deliberately placed just inside a 12-month trailing window as
of that date) but never froze the clock, unlike the very next test in the same file
(`trailingTwelveMonthDividendYield excludes rows outside the trailing 12mo window`), which already
passes an explicit `nowMs`.

As real time passed, the trailing-12-month window computed from `Date.now()` drifted forward. By
2026-09-19 (today), the `2025-09-19` fixture row crossed back OUTSIDE that window — the test had
gone from asserting "4 of 5 rows qualify" to actually needing "3 of 5 rows qualify" with zero code
change, and failed: `expected ~0.01, got 0.0075`.

### Evidence

- Reproduced live: `npx tsx --experimental-test-module-mocks --test
  src/lib/providers/polygon-options-gex.test.ts` on 2026-09-19 fails this one test, deterministically
  (not a transient flake — confirmed by re-running).
- Confirmed unrelated to PR #5238 (the PR whose CI this broke): #5238's diff touches only
  `play-brief-narrative-coaching.ts`/`.test.ts`, never this file.
- Post-fix: same command, 70/70 pass in this file.
- `npx tsc --noEmit` on Node 20: clean.

### Fix rationale

Froze the clock for the duration of this one test via `mock.timers.enable({apis: ["Date"], now:
Date.parse("2026-08-28T00:00:00Z")})` (Node test runner's built-in timer mock — the codebase
already imports `mock` from `node:test` in this file), reset in a `finally`. This makes the test
actually test what its own comments always claimed rather than silently depending on wall-clock
drift. Deliberately did not add a `nowMs` parameter to `resolveHeatmapDividendYieldUncached` itself
(the sibling `trailingTwelveMonthDividendYield` function already supports one) — the production
function correctly always wants the real current time; only the test needed pinning.

### Blast radius

Single test file, single test. `resolveHeatmapDividendYieldUncached`'s production behavior is
unchanged — this is a test-only fix.
