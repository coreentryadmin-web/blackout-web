> **kind:** FINDING

## Swing: uncalibrated thesis-health % leaked back into Verdict/Management despite #4318's withholding fix — FIXED

| Field | Value |
|-------|-------|
| **ID** | BO-P1-LARGO-002 |
| **Area** | Night Hawk Swings / Ask Largo (also live command-deck panels, same shared helpers) |
| **Status** | FIXED |

### Root cause

PR #4318 (merged earlier today) correctly taught `thesisHealthSection()` and `holdPlanSection()`
in `play-brief.ts`/`play-brief-intel.ts` to withhold the aggregate thesis-health `%` when
`thesisHealthUncalibrated()` reports the pillars are still generic defaults (committed swing
positions never get `setupState`/`entryStatus`/`signalKinds` wired, per #4318's own root cause) —
but `computeSwingThesisHealth()` still returns a real, non-null `health` number computed from those
defaults (`pillars.reduce((sum,p) => sum + p.weight*p.currentScore, 0) * 100`, rounded). Three OTHER
call sites read `play.thesisHealth.health` directly, with no `thesisHealthUncalibrated()` gate,
and leaked the exact number #4318 was supposed to withhold right back out through different sections
of the SAME brief:

1. **`thesisStrengthPct()`** (`terminal-display.ts:30`) — feeds the Ask Largo brief's **Verdict**
   section (`play-brief.ts:360,366`, "Thesis strength **X%**") and the live command-deck's
   Conviction panel (`TerminalPremiumPanels.tsx`).
2. **`thesisManagementOverlay()`** (`zerodte/thesis-health.ts:707`, shared 0DTE/swing helper) — called
   unconditionally whenever `play.thesisHealth != null` from `swingManagementVerdict()` in
   `adapters.ts`, embedding `Thesis health ${health.health}% — ${health.advisory}` into `recNote`,
   which feeds the Ask Largo brief's **Management** section (`play-brief.ts` pushes `play.recNote`
   verbatim) and the live command-deck management rail.
3. **`managementReason()`** / **`actionProbability()`** (`terminal-display.ts`) — a qualitative
   "Thesis fading" badge and a numeric `probabilityPct` confidence value, both gated only on
   `health < 60`/`health != null` with no calibration check.

**Live reproduction (2026-09-06, production, `SWING:NN`):** committed HOLD position, `thesisHealth`
pillars showing the exact `UNCALIBRATED_PILLAR_LABELS` defaults ("unknown"/"n/a"/"no signals").
`Thesis health` section correctly said *"Inputs not wired for committed positions — aggregate score
withheld."* — but **Verdict** showed `Thesis strength **46%**` and **Management** showed
`Thesis health 46% — Thesis fading — tighten risk or trim into strength.` on the SAME envelope.

### Fix

- Added `healthIsCalibrated(play)` in `terminal-display.ts`: `!(play.horizon === "SWING" &&
  thesisHealthUncalibrated(play.thesisHealth))`. Gated `thesisStrengthPct`, `managementReason`, and
  `actionProbability` on it.
- Gated `swingManagementVerdict()`'s call to `thesisManagementOverlay()` in `adapters.ts` on
  `!thesisHealthUncalibrated(play.thesisHealth)` — when uncalibrated, `recNote`/`recommendation`
  fall back to the price/manage-action-only base (`mgmtBase`), same as before #4318 ever ran.
- **Scoped to SWING only, deliberately.** 0DTE's own thesis-health computation
  (`zerodte/thesis-health.ts`) always reads live `entry_context` cortex sources — a genuinely
  partial 0DTE read produces a single-pillar `na`, not the whole-payload swing-default pattern
  `thesisHealthUncalibrated()` looks for. Applying the guard universally (no horizon check) risked
  a false positive suppressing a real, calibrated 0DTE score whenever its `momentum` pillar happened
  to read `"n/a"` for an unrelated reason — verified this does NOT happen by keeping every gate
  scoped to `play.horizon === "SWING"`.

### Evidence

- RED→GREEN: new test `refreshSwingManagement: uncalibrated thesis health ... never leaks its %
  into recNote` in `adapters.test.ts` — confirmed failing pre-fix (`recNote` contained
  `"Thesis health 46% — Thesis fading..."`), passing post-fix.
- `npx tsc --noEmit`: clean.
- `node --experimental-test-module-mocks --import tsx --test src/features/nighthawk/**/*.test.ts`:
  1352/1352 pass.
- `src/lib/swing/*.test.ts` + `src/lib/zerodte/thesis-health.test.ts`: 719/719 pass — 0DTE thesis
  health behavior unchanged (horizon-scoped guard never engages for 0DTE fixtures).
