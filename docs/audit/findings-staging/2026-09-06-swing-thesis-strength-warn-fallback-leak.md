> **kind:** FINDING

## Swing: uncalibrated thesis strength leaked via thesisBreak warn/break fallbacks — FIXED

| Field | Value |
|-------|-------|
| **ID** | BO-P1-LARGO-003 |
| **Area** | Night Hawk Swings / Ask Largo (Verdict + Conviction panel) |
| **Status** | FIXED |

### Root cause

PR #4335 gated `thesisStrengthPct()`'s direct `thesisHealth.health` read with `healthIsCalibrated()`, but
left the `thesisBreak` fallback path untouched: when `thesisBreak.level === "warn"` it still returned a
fabricated **45%** (and **15%** for `break`). On committed SWING rows, `thesisBreak` is derived from the
same uncalibrated `thesisHealth` that #4318/#4335 withhold elsewhere — so Verdict could still show
`Thesis strength **45%**` while the Thesis health section correctly said *"aggregate score withheld."*

### Fix

- `thesisStrengthPct()`: return `null` when `!healthIsCalibrated(play)` before any `thesisBreak` fallback.
- Regression tests in `terminal-display.test.ts` + extended OPEN uncalibrated case in `play-brief.test.ts`.

### Evidence

- RED→GREEN: `thesisStrengthPct: uncalibrated SWING with thesisBreak warn does not fabricate 45%`.
- `play-brief.test.ts` OPEN uncalibrated: Verdict must not contain `Thesis strength`.
