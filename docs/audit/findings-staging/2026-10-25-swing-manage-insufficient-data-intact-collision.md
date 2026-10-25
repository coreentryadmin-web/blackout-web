> **kind:** FINDING

## Swing manage-sync: a total data-outage tick was stamped identically to a real "thesis intact" check — FIXED

**Lane:** Night Hawk Swings (Ask Largo × Night Hawk Swings standing mandate)
**Date found/fixed:** 2026-10-25

### Root cause

`src/lib/swing/manage-sync.ts`'s `thesisStateOf()` mapped the PR-7 manager's verdict rung onto a coarse
`thesis_state` tag persisted on every management snapshot. Two rungs — `hold` and `insufficient_data` —
both collapsed onto the SAME `"INTACT"` tag:

- `hold` (`manage.ts`) fires only when `evaluateSwingManagement` had real, evaluable inputs (premium,
  underlying spot, DTE/lane, or at least one advisory read) and genuinely found nothing to act on — a
  real, evaluated "thesis intact" claim.
- `insufficient_data` fires when **nothing at all was evaluable** this tick — no mark, no underlying
  spot, no DTE, no thesis-break flag, no advisory read. `manage.ts`'s own doc comment calls this "a
  hollow read, not a confident HOLD" and is explicit that null-honesty requires it be distinguished from
  a real HOLD, not merged into one.

`src/lib/swing/live-plays.ts`'s 2026-10-15 fix (serving-layer INTACT override, live INTC repro) made
`thesis_state:"INTACT"` AUTHORITATIVE: it resets a cruder spot-only `structuralBreakFromSpot` "break"
read back to `"intact"` whenever the latest manage-sync snapshot says INTACT, on the documented
assumption that INTACT specifically means "the real structural/thesis check ran and did NOT find a
break." That assumption held for `hold` but was silently false for `insufficient_data` — a tick with a
total provider outage (no live spot available to the cron, no DTE, nothing) would ALSO stamp INTACT,
and the override would then reset a genuinely live-detected spot break back to "intact" purely because
the authoritative tick had zero evidence either way, not because it confirmed the thesis was fine.

### Blast radius

Single call site reads `thesis_state` with exact-string matching: `live-plays.ts`'s
`manageObservablesFromEvent` (the INTACT/BROKEN/STOPPED/EXPIRY_RISK override block,
`livePlayFromSwingPosition`'s sole consumer). `feature-store.ts`/`feature-vector.ts` carry the field
through as an opaque `string | null` for the grader/trajectory studies — no exact-string matching there,
so no further blast radius.

### Fix

`thesisStateOf()` now stamps `insufficient_data` as `"UNKNOWN"` instead of `"INTACT"`. `"UNKNOWN"`
deliberately matches none of `live-plays.ts`'s override branches (`BROKEN`/`STOPPED`/`EXPIRY_RISK`/
`INTACT`), so a hollow-read tick falls through and the serving layer keeps trusting the live spot-only
fallback instead of silently overriding it. `hold` is unchanged — still `"INTACT"`, still the one
documented state the override is actually safe to trust.

### Evidence

RED→GREEN: `src/lib/swing/active-refresh.test.ts` — new test asserts `planManageSync` with an empty
`reads` object (nothing evaluable) produces `rung:"insufficient_data"` and `thesis_state !== "INTACT"`
(failed pre-fix, passes post-fix). `src/lib/swing/live-plays.test.ts` — new sibling test to the existing
2026-10-15 INTC repro: a manage snapshot with `rung:"insufficient_data"`/`thesis_state:"UNKNOWN"` must
NOT reset a live spot-detected `"break"` back to `"intact"` (failed pre-fix — asserted the opposite of
the pre-fix behavior — passes post-fix). Full suite + `tsc --noEmit` clean post-fix.

| **Status** | FIXED |
