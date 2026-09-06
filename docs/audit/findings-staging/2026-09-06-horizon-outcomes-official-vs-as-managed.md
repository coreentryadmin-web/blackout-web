# 2026-09-06 — `get_horizon_outcomes` graded 0DTE rows on the MECHANICAL lane while claiming to report the member-facing headline — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Priority** | P2 |
| **Area** | 0DTE outcome grading / cross-lane reporting (`horizon-outcomes.ts`, Largo `get_horizon_outcomes`) |
| **PR** | (this branch) |

## Root cause

`src/lib/horizon-outcomes.ts`'s `mapZeroDteOutcome` (backing `/api/admin/nighthawk/horizon-outcomes`
and Largo's `get_horizon_outcomes`/cross-lane tools, grouped with the Track Record tool set in
`system-prompt.ts`: *"get_horizon_outcomes (graded win/loss across lanes)"*) computed its ZERO_DTE
win/loss/pnl from `record.ts`'s `officialPlanPnlPct`/`isZeroDteWin`, and the file's own header
comment called that "the canonical member-facing win/loss."

`record.ts` documents the opposite for those exact functions: `officialPlanPnlPct` backs
`mechanicalGradeView` ("MECHANICAL grade view... the labeled comparison, not the headline" —
`record.ts:324`), the number calibration and the feature store grade on. The real member-facing
headline is `managedGradeView`/`asManagedPnlPct` — "AS-MANAGED grade... the exit the member was
ACTUALLY guided to take... This is the member-facing per-play result" (`record.ts:58-61`), which is
what `buildZeroDteRecord`'s top-level `wins`/`losses`/`win_rate_pct` are built from and what
`/api/market/zerodte/record` and the Track Record UI (`NighthawkAnalyticsPanel`, `PlayHistoryTable`)
actually render.

The two lanes can genuinely disagree. `officialOverridingRealExit` (the one mechanism that lets
`officialPlanPnlPct` follow a real recorded exit) only fires when the row carries a GENUINE WS-11
trim-scale reconstruction (`readReconstructedTrimScale` — requires a non-empty `tranches` array) to
override. A row closed by a live-only exit reason (thesis-break/ratchet-floor/flat-timeout) that
never went through a trim-scale reconstruction at all — a plain ratchet-mode or single-exit row —
never reaches that override, so `officialPlanPnlPct` falls straight through to the row's raw
executable/mechanical `plan_pnl_pct`, ignoring the real exit entirely.

## Concrete divergent scenario

A row with `entry_context.executable = { plan_outcome: "doubled", plan_pnl_pct: 6.25 }` (no
`tranches` — a plain executable grade, not a WS-11 reconstruction) and
`entry_context.exit = { reason: "thesis_break:gex_walls", pnl_pct: -12 }` (a real, live-only exit):

- `record.ts`'s `managedGradeView` / `/api/market/zerodte/record` / Track Record UI: the real exit
  blocks the (nonexistent) reconstruction and reports the real exit → **loss, -12%**.
- Pre-fix `horizon-outcomes.ts`: `officialOverridingRealExit` returns null (no `reco`), falls to
  `readExecutableGrade(...)?.plan_pnl_pct` → **win, +6.25%**.

Same row, same window, opposite label on `get_horizon_outcomes`/the admin horizon-outcomes report
vs. the actual Track Record. This is a distinct gap from the already-documented mid-vs-official
divergence (`OUTCOME-GRADING-SPEC.md` §9, which `horizon-outcomes.test.ts`'s existing WS-10/WS-11
test covers) — that one is intentional and already correctly modeled; this is official-vs-as-managed,
which no existing test or spec addressed.

## Fix

`mapZeroDteOutcome` now reads `asManagedPnlPct(row)` (record.ts's own exported AS-MANAGED number,
"the same number `managedGradeView`'s headline reports") instead of `officialPlanPnlPct`/
`isZeroDteWin`. `isGradedZeroDteRow` (the graded-row gate) is unchanged — only the pnl/win source
once a row is confirmed graded. Also corrected the file's header comment, which stated the false
claim that caused this gap, so a future reader doesn't reintroduce the same mismatch.

## Evidence

- New test, RED before / GREEN after (`git stash` on `horizon-outcomes.ts`, test kept): "a
  live-only exit (thesis_break) that ISN'T a WS-11 reconstruction reports the AS-MANAGED result,
  not the executable/mechanical one" — failed (`label` was `"win"`, `pnl_pct` was `6.25`) pre-fix.
- `horizon-outcomes.test.ts`: 14/14 pass post-fix, including the pre-existing WS-10/WS-11
  reconstruction test (line 117) — unaffected, since that fixture has no `entry_context.exit` and
  both `officialPlanPnlPct` and `asManagedPnlPct` agree on it (the reconstruction path is the one
  case the two lanes are DESIGNED to agree on — `record.ts:414-416`: "one and the same, so the
  headline and the grade agree by construction").
- `record.test.ts`: 30/30 pass (untouched, confirms no regression to `record.ts` itself).
- `tsc --noEmit`: clean.
- Full `npm test` (Node 20): pending in this PR's evidence trail (see push).

## Blast radius

- `horizon-outcomes.ts` only — `record.ts` (the source of truth) is unchanged.
- Confirmed via grep that `get_grader_agreement` (a separate, dedicated lane-comparison tool,
  `evidence-reads.ts`) does not read `horizon-outcomes.ts` — its purpose (comparing grading lanes)
  is unaffected by this fix.
- No change to `/api/market/zerodte/record`, the Track Record UI, calibration, or the feature
  store — all already correctly used their own lane's number.

## Fix rationale

Matches the file's own stated intent (`mapZeroDteOutcome`'s job is to report "the SAME number"
`/api/market/zerodte/record` reports) rather than inventing new behavior — the bug was a comment
that asserted the wrong function achieved that, not a design question. `truth_kind: "official"` is
left unchanged: the label already meant "the record's authoritative number" in the file's own
framing, and the fix makes the code match that framing rather than renaming around the bug.
