## Swing thesis-health's per-pillar calibrated filter never recognized the Banger-ledger regime sentinel — a fabricated "Regime fit" rendered as a real read

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Date** | 2026-09-22 |
| **Severity** | P2 (Largo product-contract C6 violation, live and member-reachable via Ask Largo's swing play-brief — fabricated precision presented as calibrated, no capital/gating impact) |
| **Surface** | Night Hawk Swings / Ask Largo — `src/lib/swing/thesis-health.ts` |

### Root cause

`thesis-health.ts` has two separate mechanisms that are supposed to recognize the exact same set of
"this pillar's `currentLabel` is a fabricated default, not a real read" sentinel values, and until this
fix they diverged:

- `thesisHealthUncalibrated(h)` — an OR-across-pillars check that decides whether the AGGREGATE health
  score must be withheld. It looped over `UNCALIBRATED_PILLAR_LABELS` (persistence/entry_geometry/
  flow_corroboration) AND had a fourth, separately hardcoded check specifically for the regime pillar:
  `if (regimePillar?.currentLabel === BANGER_LEDGER_REGIME_LABEL) return true;`.
- `calibratedThesisPillars(h)` (added 2026-09-21, per-pillar filter deciding which individual pillar
  ROWS survive into the rendered body even when the aggregate is withheld) — derives its filter set,
  `UNCALIBRATED_MAPPED_LABELS`, purely from `UNCALIBRATED_PILLAR_LABELS` via `Object.fromEntries`. It
  never saw the regime sentinel, because the sentinel lived only in the separate hardcoded branch inside
  `thesisHealthUncalibrated`, not in the shared map `calibratedThesisPillars` actually reads.

Net effect: for any Banger-ledger-origin position (`BANGER_LEDGER_REGIME_LABEL = "BREAKOUT · BANGER"`,
stamped unconditionally on every `banger_positions` ledger row by `horizonPlayFromBangerPosition`/
`horizonPlayFromBangerWatch` in `banger-lane-merge.ts` — a fixed constant, never a real per-position
regime calc), `thesisHealthUncalibrated()` correctly withheld the blended aggregate score, but
`play-brief.ts`'s `thesisHealthSection()` — which renders the individual pillar bullets via
`calibratedThesisPillars(h)` once the aggregate is withheld — kept the regime pillar in the list, because
`calibratedThesisPillars` had no way to recognize it as fabricated. A member reading that position's Ask
Largo play-brief saw a line like `"**Regime fit** — BREAKOUT · BANGER (Δ +0.0 pts)"` formatted identically
to the genuinely-calibrated pillars beside it, with no indication it was a stamped constant rather than a
measured read — the exact class of C6 violation `LARGO-PRODUCT-CONTRACT.md` names: "If a product cannot
produce a calibrated score, OMIT the field... An invented score is worse than nothing."

### Evidence

Live repro via `GET /api/market/swing/play-brief?playId=SWING:NMAX:1264&ticker=NMAX&positionId=1264&expandIntel=1`
(NMAX, positionId 1264, a Banger-lane merged row): the rendered Thesis health section included
`"**Regime fit** — BREAKOUT · BANGER (Δ +0.0 pts)"` alongside the "Aggregate score withheld" note, i.e.
one specific pillar row rendered as if calibrated while the surrounding text says the aggregate isn't.
Traced in source: `grep -n BANGER_LEDGER_REGIME_LABEL src/lib/swing/banger-lane-merge.ts` confirms the
constant (`"BREAKOUT · BANGER"`, line 39) is stamped unconditionally at both ledger-merge call sites
(lines 141, 217). Confirmed `UNCALIBRATED_PILLAR_LABELS` (pre-fix) carried only
`persistence`/`entry_geometry`/`flow_corroboration` and no `regime` key, so
`UNCALIBRATED_MAPPED_LABELS[market]` was `undefined` and `calibratedThesisPillars`'s filter
(`p.currentLabel !== UNCALIBRATED_MAPPED_LABELS[p.id]`) always kept the regime pillar regardless of its
label.

New regression test (`thesis-health.test.ts`, inside the existing "Banger-origin ledger rows..." describe
block): asserts `calibratedThesisPillars(h)` drops the `"market"`-id pillar for the same
`bangerLedgerInput` fixture the block's other tests already use. RED confirmed via `git stash push --
src/lib/swing/thesis-health.ts` (assertion failed: `keptIds` still included `"market"`). GREEN after
restoring the fix. Full `thesis-health.test.ts` suite: 16/16 pass. Collateral sweep (`play-brief.test.ts`,
`play-brief-narrative.test.ts`, `play-brief-pillar-guard.test.ts`, `roll-plan.test.ts`,
`serving-lane.test.ts` — every test file in the swing lane that imports `thesis-health.ts` or its two
functions): 253/253 pass. `npx tsc --noEmit` clean.

### Fix

Added `regime: BANGER_LEDGER_REGIME_LABEL` to `UNCALIBRATED_PILLAR_LABELS`, the single shared map both
`thesisHealthUncalibrated`'s main loop and `calibratedThesisPillars`'s derived
`UNCALIBRATED_MAPPED_LABELS` already read from. This makes both mechanisms automatically agree on the
regime sentinel using the EXISTING filter machinery — no new branch, no new logic. Removed the now-
redundant separate hardcoded regime check inside `thesisHealthUncalibrated` (the main loop over
`UNCALIBRATED_PILLAR_LABELS` now covers it), folding its explanatory comment into the function's own doc
comment so the reasoning (why a stamped-constant regime string counts as fabricated the same way
"unknown"/"n/a"/"no signals" do) isn't lost.

### Blast radius

One file changed for behavior (`thesis-health.ts`). `thesisHealthUncalibrated`'s own return value is
unchanged for every input (the regime sentinel was already caught by its now-removed separate branch, so
no aggregate-withhold behavior moved) — only `calibratedThesisPillars`'s per-pillar output changes,
dropping the regime pillar for Banger-ledger-origin rows specifically. Every consumer of
`calibratedThesisPillars` (`play-brief.ts`'s `thesisHealthSection`, the only render call site, per repo-
wide grep) now correctly omits the fabricated line instead of rendering it. No other caller of either
function exists outside the swing lane's own play-brief/narrative/serving files, all covered by the
collateral test run above.

### Fix rationale

Fix at the shared data layer (the map both functions already read), not by adding a second bespoke check
to `calibratedThesisPillars` that would need to be kept in sync with `thesisHealthUncalibrated`'s by hand
— the exact kind of two-mechanisms-that-should-agree-but-don't drift this bug itself was an instance of.
Deliberately left unchanged: the aggregate-withhold behavior and every other pillar's calibrated/
uncalibrated classification.
