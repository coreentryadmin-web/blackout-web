# 2026-11-09: Swing play-brief "Industry read" line re-diverged from `fmtPct()` at sign-tie boundaries — the 2026-10-26 sign-bias fix never reached this call site

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

Night Hawk Swings' Ask Largo play-brief, "Why this setup" section, "Industry read" line
(`whyThisSetupSection`, `src/lib/swing/play-brief-intel.ts`) computes its own LOCAL rounded
operands (`roundedName`/`roundedGroup`/`roundedDelta`) with the plain, sign-biased
`Math.round(x * 10) / 10` pattern, while the parenthetical operands right beside it in the SAME
sentence render via the already-fixed `fmtPct()` helper (`src/lib/fmt-money.ts`). These two
rounding paths used to be equivalent — a 2026-10-09 fix at this exact call site (see
`docs/audit/FINDINGS.md`, "Swing 'Industry read' industry-group RS" entries) relied on that
equivalence to guarantee the headline "by X%" delta always equals the subtraction a reader does
from the two displayed `fmtPct()` operands. `fmtPct()` was independently upgraded on 2026-10-26 to
fix a sign-bias tie bug (`Math.round(-13.5) === -13` but `Math.round(13.5) === 14` — a negative
value sitting exactly on a display-precision tie rounds to a SMALLER magnitude than the identical
positive case), and today's large ~20-file sign-bias sweep applied the same fix to every sibling
formatter it found — but missed this call site's own local rounding, so the two algorithms
silently diverged again, at exact tie boundaries, reopening the exact cross-field-consistency
failure the 2026-10-09 fix was built to close. Found/confirmed by this cycle's Ask Largo standing
mandate.

## Root cause

`whyThisSetupSection`'s sector-rotation-leadership branch computed:

```
const roundedName = Math.round(f.nameReturnPct * 10) / 10;
const roundedGroup = Math.round(f.groupReturnPct * 10) / 10;
const roundedDelta = Math.round((roundedName - roundedGroup) * 10) / 10;
```

while the same line's parenthetical operands render via `fmtPct(f.nameReturnPct)` /
`fmtPct(f.groupReturnPct)`, whose current implementation (fixed 2026-10-26) is:

```
const rounded = (Math.sign(n) * Math.round(Math.abs(n) * factor)) / factor;
```

For `n = -8.25` at 1dp: `fmtPct` rounds `Math.abs(-8.25) * 10 = 82.5` away from zero to `83`, then
reapplies the sign → `-8.3`. The old local `Math.round(-8.25 * 10) / 10` instead computes
`Math.round(-82.5) / 10 = -82 / 10 = -8.2` (JS `Math.round` ties toward `+Infinity`, so a negative
tie rounds toward zero, not away from it). The two paths disagree by 0.1pp exactly at this
boundary — and because `roundedDelta` is derived from `roundedName`/`roundedGroup`, the disagreement
propagates into the sentence's own headline number, not just a cosmetic rounding nit: the
subtraction a reader does from the two displayed `fmtPct()` operands can differ from the stated
"by X%" lag/lead magnitude.

## Evidence (RED → GREEN)

Repro inputs: `nameReturnPct = -8.25` (an exact .x5 tie at 1dp), `groupReturnPct = 1.0`.

- `fmtPct(-8.25)` → `"-8.3%"`, `fmtPct(1.0)` → `"+1.0%"` (displayed operands).
- A reader subtracting the two displayed operands: `+1.0% − (-8.3%) = 9.3%`.
- OLD (buggy) local rounding: `roundedName = Math.round(-82.5)/10 = -8.2`, `roundedGroup = 1.0`,
  `roundedDelta = Math.round((-8.2 - 1.0) * 10) / 10 = -9.2` → headline rendered **"by 9.2%"**,
  disagreeing with the 9.3% a reader gets from the displayed operands.
- NEW (fixed) sign-safe rounding: `roundedName = -8.3`, `roundedGroup = 1.0`, `roundedDelta = -9.3`
  → headline renders **"by 9.3%"**, matching the displayed operands exactly.

RED (pre-fix, via `git stash` isolating only the source file `play-brief-intel.ts`, leaving the
new test in place): `npx tsx --experimental-test-module-mocks --test
src/lib/swing/play-brief-intel.test.ts` — 1/370 failed (the new regression test), asserting the
rendered line against the regex expecting `"by 9.3% ... (-8.3% vs +1.0%)"`; actual output was
`"by 9.2% ... (-8.3% vs +1.0%)"`.

GREEN (post-fix, source restored): same command, 370/370 pass. `npx tsc --noEmit` clean (exit 0).
Run on Node 20.20.2 per the repo's environment notes.

## Fix

Replaced the three local `Math.round(x * 10) / 10` calls with the identical sign-safe,
round-by-magnitude-then-reapply-sign algorithm `fmtPct()` uses internally
(`(Math.sign(n) * Math.round(Math.abs(n) * 10)) / 10`), scaled to this call site's own 1-decimal
precision. No shared/exported helper for this exact pattern existed yet in the codebase (checked:
every sibling fix from today's sweep — `round-floats.ts`, `fmt-money.ts`, several
`features/nighthawk/*` files — inlines the same formula locally rather than importing a common
helper), so this keeps the existing local-inline style consistent with its neighbors rather than
introducing a new abstraction as a side effect of a single-call-site bug fix. The final
`roundedDelta` subtraction still gets the same formula applied (rather than plain `Math.round`)
so the float-noise cleanup step after subtracting (e.g. `1.6 − 1.3 === 0.2999999999999998` in
IEEE 754) doesn't itself reintroduce a sign-tie mismatch.

## Blast radius

One function (`whyThisSetupSection`), one file (`play-brief-intel.ts`), the "Industry read" line
only. No other call site in this file computes `roundedName`/`roundedGroup`/`roundedDelta`.

**Explicitly NOT fixed in this PR:** a sibling candidate from the same 2026-11-09 sweep —
`src/lib/swing/play-brief-lane-rank.ts`'s `computeLaneRank` (`medianScore`/`deltaFromMedian`,
~lines 192/232) — was flagged with the identical bug class but did **not** survive this cycle's
adversarial verification (refuted / not confirmed). It was deliberately left untouched here so a
future session doesn't assume it was already handled by this PR — re-verify it against the current
source independently before fixing or dismissing it.
