> **kind:** FINDING

## 0DTE record: WS-11 reconstructed trim-scale rows can carry a `stopped`/`doubled` label that contradicts the row's own positive/negative blended P&L — FIXED

| **Status** | Fixed |
|---|---|

**Found by:** standing Ask Largo × Night Hawk Swings / 5-engine live-monitor mandate, 2026-11-01
audit cycle, directly adversarially verifying the "Fixed" status on
`docs/audit/findings-staging/2026-11-01-zerodte-managed-outcome-label-sign-mismatch.md` (folded via
PR #7133) against live production data.

**This is a DISTINCT bug from the one #7133 fixed, despite surfacing identical symptoms on the
SAME live row.** #7133's root-cause diagnosis (`managedOutcomeLabel`'s unguarded `"stop"`/
`"target"` category→label mapping) does not apply to `play index 588` (META, `session_date`
2026-08-03) from the live 90-day pull cited in that finding: the row's `managed_source` is
`"reconstructed"`, not `"engine"`, and its `entry_context` carries **no top-level `exit` key at
all** — so `readManagedExit()` returns `null` and `managedOutcomeLabel()` is never invoked for this
row. #7133 shipped a correct, narrowly-scoped fix for the `"engine"` branch, but the contradiction
on this specific row is still live in production right now because it is driven entirely by a
different function, `reconstructedGradeView()` (and the parallel raw read in
`officialPlanOutcome()`), which #7133 never touched.

**Root cause:** `src/lib/zerodte/plan.ts`'s `reconstructTrimScaleExecutableFromBars` (WS-11) labels
its `outcome` field by how the **RUNNER** (the final, largest-consequence tranche) closed —
`"doubled"`/`"stopped"`/`"time_stop"` — while `plan_pnl_pct` is the **FRACTION-WEIGHTED BLEND**
across every tranche (that function's own doc comment: "ONE OFFICIAL NUMBER"). Two early,
profitable trims can outweigh a losing final leg (or the symmetric case for a winning final leg
after losing trims), so the runner-reason label and the blended sign can legitimately disagree.
`record.ts`'s `reconstructedGradeView()` (the as-managed headline for a `"reconstructed"` row) and
`officialPlanOutcome()` (the calibration/feature-store/Largo-facing OFFICIAL lane) both read
`reco.plan_outcome` verbatim, with no check against the blended `plan_pnl_pct` sign at all — unlike
`managedOutcomeLabel`'s `"stop"`/`"target"` branches, which #7133 already sign-guards for the live
engine-exit path.

**Live evidence (`GET /api/market/zerodte/record?days=90`, 2026-11-01):** `plays[588]`, META,
`session_date` 2026-08-03 — `managed_source:"reconstructed"`, `managed_outcome:"stopped"`,
`managed_pnl_pct:+3.41`; the identical contradiction on the `"official"` lane feeding
calibration/feature-store: `plan_outcome:"stopped"`, `plan_pnl_pct:3.41`.
`entry_context.executable.tranches`:
```
[{"exit_reason":"trim_scale_first","exit_pnl_pct":19.32},
 {"exit_reason":"trim_scale_second","exit_pnl_pct":43.18},
 {"exit_reason":"stopped","exit_pnl_pct":-52.27}]
```
Blended: (19.32 + 43.18 − 52.27) / 3 = +3.41 — a genuine win — but the runner's own reason
(`"stopped"`) rendered it under the loss-implying `"stopped"` label on both the as-managed
headline and the official lane. `entry_context` has no top-level `exit` key, confirming
`readManagedExit()` returns `null` and this row never reaches `managedOutcomeLabel`. The live
`by_outcome.stopped` bucket (`n=58, wins=1, losses=57`) carried exactly this one anomalous win — a
bucket whose label implies "loss" reporting a nonzero win count. Top-level aggregate math
(`wins+losses+breakeven==graded`, every bucket breakdown summing back to the headline) was already
exact — this bug affects only the per-row/per-bucket **label**, never the win/loss/breakeven
**counts** (both `reconstructedGradeView.win` and `mechanicalGradeView.win`/`officialPlanPnlPct`
already decide win/loss by sign, independent of this label).

**Fix:** added `reconstructedOutcomeLabel(outcome, pnl)` in `src/lib/zerodte/record.ts` — the same
sign-guard discipline as `managedOutcomeLabel`'s `"stop"`/`"target"` branches: falls back to a bare
`"win"`/`"loss"`/`"breakeven"` label when the runner-reason label's implied sign disagrees with the
real blended pnl; `"time_stop"` (no implied sign) and any other value pass through unchanged. Wired
into BOTH:
1. `reconstructedGradeView()` — the as-managed headline (`plays[].managed_outcome`,
   `by_outcome` bucketing) for every `"reconstructed"`-sourced row.
2. `officialPlanOutcome()` — the OFFICIAL lane (`plays[].plan_outcome`, and therefore
   `mechanical.by_outcome` via `mechanicalGradeView`, plus everything downstream that reads
   `officialPlanOutcome` directly: `src/lib/largo/evidence-eval.ts`'s pinned-answer `official:`
   string) — gated on `readReconstructedTrimScale(...)` returning non-null, so a ratchet/legacy row
   (no tranches, structurally sign-safe by construction — a single stop/target walk can never
   disagree with its own sign) is completely untouched.

Read-time reconciliation only, same pattern as this file's existing `clampManagedPnlToPeak`/
`withRoundedTrailingRuleDisplay` — never mutates the frozen `entry_context.executable` blob, only
the label a future read renders.

**Evidence (RED → GREEN):** added 2 test cases to `src/lib/zerodte/record.test.ts` reproducing the
exact live META tranche shape (positive-blend/`"stopped"`-runner — the live bug) plus a symmetric
control (negative-blend/`"stopped"`-runner — must NOT regress). RED (pre-fix, verified via a
temporary revert of `record.ts` alone, test file unchanged):
`reconstructedOutcomeLabel: a WS-11 trim-scale reconstruction with a POSITIVE blended pnl buckets
by sign, not 'stopped'` failed — `managed_outcome` rendered `"stopped"` instead of the expected
`"win"`. GREEN (post-fix): `npx tsx --experimental-test-module-mocks --test record.test.ts` →
54/54 pass (up from the pre-existing 52). `npx tsc --noEmit`: clean.

**Blast radius — swept, no further sites needed fixing:**
- `src/lib/largo/evidence-eval.ts` (`official: `${officialPlanOutcome(row) ?? "graded"} ...`) —
  already benefits automatically, imports and calls `officialPlanOutcome` directly.
- `src/lib/zerodte/governor.ts`'s `ledgerRowStopped` — checked and NOT in scope: it checks
  `readManagedExit` (the live engine's real-time exit stamp) first, falling back to the RAW
  mechanical mid `plan_outcome` column (always a single-walk grade, structurally sign-safe) — it
  never reads `entry_context.executable.plan_outcome` (the reconstruction) at all, and by the time
  a WS-11 reconstruction is backfilled onto a row (a post-close lazy-grading pass), the governor's
  live intra-session halt tally has already long since evaluated that row under a different signal.
- `src/lib/zerodte/calibration.ts` — decides win/loss exclusively via `isZeroDteWin`/
  `officialPlanPnlPct` (sign-based), never via any outcome label string. Unaffected.
- `src/lib/zerodte/feature-store.ts`'s `labelFromPlanOutcome` — the raw mid-column `outcome` string
  is used only as an evidence GATE (is this one of doubled/stopped/time_stop at all), never as the
  win/loss decision itself (that's `isZeroDteWin`, sign-based). Unaffected.
- `src/lib/zerodte/similarity.ts` — surfaces the RAW mid-column `plan_outcome` (always a
  single-walk mechanical grade) purely as supplementary display data alongside the already
  sign-correct `label`; by design this can differ from the win/loss label (the same "mechanical is
  a labeled comparison, never the headline" discipline documented throughout this module).
  Unaffected.
- `src/lib/zerodte/tier-export.ts`'s `stored_executable_outcome` — explicitly named/documented as
  the raw DB-stamped value for an admin diagnostic export; every real-cost A/B backtest script that
  consumes this export replays the real exit-engine functions itself rather than trusting the
  label. Deliberately left as the raw diagnostic it is; out of scope.

**Fix rationale:** mirroring `managedOutcomeLabel`'s existing sign-guard (rather than inventing a
different shape) keeps the two label functions symmetric and auditable side by side, and reuses
the same `bySign` fallback vocabulary (`"win"`/`"loss"`/`"breakeven"`) the record's `by_outcome`
bucketing already sorts and displays correctly for the `managedOutcomeLabel` case. Deliberately did
NOT touch `plan.ts`'s `reconstructTrimScaleExecutableFromBars` itself — its `outcome` field is
explicitly documented as "labels how the RUNNER... closed, so by_outcome bucketing stays
meaningful" for the construction/audit-trail use (the per-tranche array is the real detail); fixing
at the two `record.ts` read sites that render it as a member/Largo-facing label is the narrower,
correctly-scoped change, consistent with this module's read-time-reconciliation precedent (clamp
the display, never rewrite the frozen write).
