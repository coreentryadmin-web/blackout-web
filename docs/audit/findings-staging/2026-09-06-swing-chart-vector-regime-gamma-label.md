> **kind:** FINDING

## Ask Largo swing brief — "Vector regime" label read as a directional call, not dealer gamma posture — FIXED

| Field | Value |
|-------|-------|
| **ID** | BO-P2-LARGO-003 |
| **Area** | Night Hawk Swings / Ask Largo — Chart technicals section |
| **Status** | FIXED |

### Root cause

`chartTechnicalsSection()` (`play-brief-intel.ts`) printed `vec.regime.posture` bare as
`Vector regime: **long**`/`**short**` — but `deriveVectorRegime()` (`vector-regime.ts`) computes
this from `spot` vs `gammaFlip`, i.e. it is a **dealer gamma regime** (long-gamma/short-gamma
dealer positioning), not a directional trade call.

This sits in the same "Chart technicals" section as genuinely directional signals (EMA stack,
MACD, structure direction) and immediately precedes the separate "Vector desk" section's own
directional POSITION call for the same ticker. Live reproduction (2026-09-06, `SWING:NN`):
"Chart technicals" showed `Vector regime: **long**` while the very next section, "Vector desk",
showed `POSITION · momentum short on continuation` for the same NN row — a member reading both
in sequence can easily misread "long" as a directional signal contradicting "short," when the two
words describe entirely unrelated things (dealer gamma state vs. a directional momentum call).

Every OTHER call site that reads the same `regime.posture` field (`play-brief-narrative.ts`'s
`dealerPostureLine` and two other spots) already renders it explicitly as "dealer gamma posture" —
only this one call site in `play-brief-intel.ts` left it unlabeled.

### Fix

`chartTechnicalsSection()` now renders `Dealer gamma regime: **long gamma**` / `**short gamma**` /
`**transition** (near flip)` instead of the bare `Vector regime: **long**`/`**short**` — consistent
with the labeling already used everywhere else this field is surfaced. No data changed, only the
label.

### Evidence

- RED→GREEN: new test `chartTechnicalsSection: Vector regime is labeled as dealer GAMMA posture,
  never bare long/short` in `play-brief-intel.test.ts` — confirmed failing pre-fix (bare
  `Vector regime: **long**`), passing post-fix.
- `npx tsc --noEmit`: clean.
- `src/lib/swing/play-brief-intel.test.ts`: 32/32 pass.
- `src/lib/swing/*.test.ts` (full suite): 725/725 pass.
