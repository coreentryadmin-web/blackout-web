# 0DTE ledger achievability ceiling used the wrong threshold — dead zone let already-doomed fills grade as instant stops — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P1-zerodte-entry-premium-ceiling-stop-gap |
| **Priority** | P1 |
| **Area** | 0DTE entry-premium sourcing — `resolveLedgerEntryPremium` (`src/lib/zerodte/plan.ts`) |
| **Status** | FIXED |

## Symptom

Live forensic audit (2026-09-10/11, Night Hawk 0DTE lane), upgraded from a single QQQ instance to a
confirmed 7-instance systemic pattern via a 90-day record backtest: near-instant (<5s of commit)
"stopped" exits at catastrophic P&L (-51% to -90%), reported on PR #4076. Example: QQQ short
committed 2026-09-09T16:14:39.000Z, `plan_stop` fired 2026-09-09T16:14:39.910Z (0.91s later) at
`managed_pnl_pct: -51.42`. Confirmed instances: SPXW 2026-08-12 -52.96% (Δ1.73s), QQQ 2026-08-26
-89.99% (Δ1.86s), SPXW 2026-08-26 -63.55% (Δ0.92s), NVDA 2026-08-27 -52.90% (Δ1.25s), QQQ 2026-08-27
-77.06% (Δ0.36s), MSFT 2026-08-28 -52.07% (Δ3.20s), QQQ 2026-09-09 -51.42% (Δ0.91s). No member could
have owned any of these positions for even one real tick before the stop fired.

## Root cause

`resolveLedgerEntryPremium` (`plan.ts:511-524`) already has an "achievability ceiling" (shipped
2026-08-27, a prior live finding) that caps the ledger's graded entry basis DOWN to the flag-time
mark when a stale/outlier flow fill sits far enough above the live market — protecting the grade
from an unachievable fill. But the ceiling's trigger threshold was `CHASE_PCT` (55%), reused from a
completely different, unrelated concept: the UP-side "MOVED, don't chase" band, tuned specifically
for how much normal 0DTE gamma-driven premium swing is routine (see `plan.ts`'s own comment: "55 not
35... a 0.2% underlying move can swing the option premium 30-50%"). That threshold has nothing to do
with achievability.

The play's own hard stop is fixed at `PLAN_RULES.stop_pct = -50%`. Since the ceiling's correction
threshold (55%) sits **above** the stop threshold (50%), there was a 5-percentage-point dead zone:
a flow fill dislocated 50-54.99% above the live mark stayed **uncorrected** (`pctBelow < 55` never
fires the ceiling), even though the live mark was **already at or past the play's own -50% stop**
the instant a real quote was checked. The ledger committed the trade at the stale, inflated basis,
and `gradePlanFromBars`/the live exit engine correctly evaluated that basis against the (also
correct) live mark — and found it already stopped out, because the entry itself was never a
real, tradeable price.

Reproduced mechanically with the exact shipped function (`board.test.ts`, verified failing before
the fix): `resolveLedgerEntryPremium(10.0, 10.0, 5.0)` — a mark exactly 50% below the fill — returned
the stale `10.0` (uncorrected) instead of capping to the achievable `5.0`, because `50 < CHASE_PCT
(55)`. At `pctBelow = 54.99`, same story. Only at `pctBelow >= 55` did the existing ceiling kick in.

## Evidence

RED→GREEN, `src/lib/zerodte/board.test.ts`:
- Updated `"resolveLedgerEntryPremium: caps the graded basis DOWN..."` to assert the new
  `STOP_TRIGGER_PCT` (50%) boundary instead of the old `CHASE_PCT` (55%) one: a mark exactly 50%
  below the fill now corrects (`resolveLedgerEntryPremium(10.0, 10.0, 5.0) === 5.0`); the old
  dead-zone shape (54.99% below) now correctly corrects too (`resolveLedgerEntryPremium(10.0, 10.0,
  4.501) === 4.5`, rounded); a dislocation just under the new 50% boundary (49.99% below) still
  stays uncorrected, unchanged from before.
- **Pre-fix** (production code reverted to `origin/main`, test file kept): `npx tsx
  --experimental-test-module-mocks --test src/lib/zerodte/board.test.ts` — 131 pass / **1 fail**
  (`10 !== 5` — the exact-50%-boundary case that used to slip through uncorrected).
- **Post-fix**: same file — **132 pass / 0 fail**.
- Full `src/lib/zerodte/*.test.ts` — 1399 pass / 0 fail (1 skipped, unrelated).
- Full `npm test` (Node 20) — **13720 pass / 0 fail** (3 skipped, unrelated).
- `npx tsc --noEmit` — clean.

## Blast radius

`resolveLedgerEntryPremium` has three call sites, all in `scan.ts`, all at the live-commit write
path (the one place this repo persists `entry_premium` to the ledger). No other consumer computes
or re-derives this ceiling logic independently — grepped repo-wide. The fix only changes the
**threshold** the existing ceiling branch compares against; the branch's own shape (cap down to
`round2(markAtFlag)` when triggered), the separate achievability **floor** (mark above the fill —
untouched, a completely different branch), and every other gate/exit-engine/grading function are
unaffected. Ordinary front-running (mark modestly below the fill, well under 50%) is unaffected —
verified by the existing `resolveLedgerEntryPremium(4.0, 4.0, 3.5)` test (12.5% below, stays 4.0).

This closes the dead zone precisely for the **-51% to -54%-ish cluster** of the 7 confirmed
instances (QQQ 2026-09-09, SPXW 2026-08-12, NVDA 2026-08-27, MSFT 2026-08-28 — all landed inside the
old 50-55% dead zone). It does **not** fully explain the more extreme instances (QQQ 2026-08-26
-89.99%, QQQ 2026-08-27 -77.06%, SPXW 2026-08-26 -63.55%) — those dislocations are well past even
the old 55% CHASE_PCT threshold, so the OLD ceiling should have already caught them; either the
flag-time mark (`markAtFlag`/`s.plan.mark`) was genuinely `null` for those specific commits (no live
quote captured that instant, so no ceiling correction of any kind could apply — a `resolveLedgerEntryPremium(base, flowAvgFill, null)`
call has no `markAtFlag` to bound against at all), or a different mechanism is in play. That
remaining question — why `s.plan.mark`/`quoteAgeMs` can be null on the FLOW-origin live-commit path
for the most extreme instances, and whether `liveCommitPreconditionsUnmet`'s `quote_age_unknown`
guard (shipped 2026-09-09, PR #4649, a separate and already-correct fix for the "measurement
entirely missing" case) is actually catching those going forward — is **not** resolved by this fix
and is left open for a follow-up measurement (the historical `plan`/`quoteAgeMs` state at commit
time is not persisted to `entry_context`, so it cannot be reconstructed retroactively from the DB;
it would need either a fresh live reproduction or production log access this sandbox cannot reach).

## Fix rationale

Introduced a dedicated `STOP_TRIGGER_PCT = Math.abs(PLAN_RULES.stop_pct)` constant and switched the
ceiling branch's comparison from `CHASE_PCT` to it, rather than just lowering `CHASE_PCT` itself —
`CHASE_PCT` is a real, independently-tuned, correctly-set threshold for its own (UP-side, MOVED)
purpose and touching its value would risk reintroducing the exact over-blocking regression its own
comment documents (2026-07-27: "35% sat inside normal intraday noise and blocked high-quality
setups"). The two thresholds answer genuinely different questions — "is this much premium runup
already-happened, not routine gamma" (CHASE_PCT, 55%) vs. "is this fill dislocated enough that
grading against it is already an unavoidable stop" (the new STOP_TRIGGER_PCT, 50%, tied to the
play's own actual stop rule) — and deserve to stay two separate, independently-tunable constants
even though they happen to differ by only 5 points today. Deriving `STOP_TRIGGER_PCT` from
`PLAN_RULES.stop_pct` (rather than a second hardcoded literal) keeps the two structurally coupled:
if the stop percentage is ever retuned, the achievability ceiling retunes with it automatically,
which is the correct invariant — the ceiling's whole purpose is "would this already be past the
play's own stop," so it must always track whatever that stop actually is.
