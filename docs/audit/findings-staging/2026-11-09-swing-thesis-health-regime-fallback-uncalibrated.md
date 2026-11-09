## 2026-11-09: Swing thesis-health "Regime fit" pillar rendered the bare word "Regime" as a calibrated read — third variant of the C6 fabricated-precision pattern through `regimeScore()`

> **kind:** `FINDING`

**Status.** FIXED — this PR.

### Summary

`src/lib/swing/thesis-health.ts`'s `regimeScore()` falls back, when a position's live `regime`
display string is `null`, to the label of whichever `factors[]` entry is actually named
`SWING_PILLAR_LABELS.REGIME` ("Regime") — correct behavior fixed by commit `7e0fe038e` / PR #6931
(2026-10-26), which closed a prior bug where this function instead borrowed a *different* pillar's
label (whichever factor happened to score highest). But #6931 left a new gap: when a "Regime"
factor entry does exist — the common case whenever the REGIME pillar scored any points at
commit — the fallback label becomes the bare, tautological word **"Regime"** itself: just the
category name, with zero descriptive content. `UNCALIBRATED_PILLAR_LABELS.regime` was never
updated to recognize this new possible fallback value alongside the pre-existing
`BANGER_LEDGER_REGIME_LABEL`/`"unread"` sentinels, so a "Regime fit" pillar whose `currentLabel` is
literally "Regime" passed straight through `thesisHealthUncalibrated()`/`calibratedThesisPillars()`
as if it were a real, calibrated per-position regime read — the blended aggregate % was shown, not
withheld, even though one of its five weighted inputs (15% weight, `DEFAULT_WEIGHTS.regime`) was
really just the bare category name.

This is the **third** independently-reachable variant of the same C6 ("fabricated precision
presented as calibrated") pattern through this one function. The first two were fixed 2026-09-22
(grep `UNCALIBRATED_PILLAR_LABELS` in `docs/audit/FINDINGS.md`) for the `"unread"` native-default
case and the `BANGER_LEDGER_REGIME_LABEL` stamped-constant case — both predate #6931. #6931 then
introduced this third gap while fixing an unrelated bug (borrowing the wrong pillar's identity),
and neither of the 2026-09-22 fixes ever covered it.

### Root cause

```ts
function regimeScore(regime: string | null | undefined, factors: DeckFactor[] | undefined) {
  const top = factors?.find((f) => f.label === SWING_PILLAR_LABELS.REGIME);
  ...
  return { commit: score, current: score, label: regime ?? (top ? top.label : "unread") };
}
```

When `regime` is `null` and a factor literally labeled `"Regime"` exists, `top.label` IS
`"Regime"` — `SWING_PILLAR_LABELS.REGIME`'s own value (`swing-pillars.ts` line ~113). That string
was absent from `UNCALIBRATED_PILLAR_LABELS.regime = [BANGER_LEDGER_REGIME_LABEL, "unread"]`
(`thesis-health.ts` ~line 63), so both consumers of that array —
`thesisHealthUncalibrated()` (~line 101) and `calibratedThesisPillars()` (~line 185) — treated a
`currentLabel` of `"Regime"` as a genuine, calibrated value rather than recognizing it as a
generic/fabricated default.

### Evidence

Confirmed live: `GET /api/market/nighthawk/horizons?view=swings` showed committed SWING position
MRVL (positionId 70) with `"regime": null` at the top level, and its own `factors[]` carrying
`{"label": "Regime", "points": 8.3}`. `GET /api/market/swing/play-brief?playId=SWING:MRVL&
ticker=MRVL&positionId=70` rendered the "Thesis health" section's aggregate as "**51%** ·
Degraded" (shown, not withheld) with a self-referential "Regime fit — Regime" line, while sibling
positions with a real non-null `regime` field (e.g. PLTR/GOOG) render real descriptive text like
"Sector rotation leadership · regime 1.00".

### Evidence (RED → GREEN)

RED (pre-fix, via `git stash` isolating only `thesis-health.ts`, keeping the new test in
`thesis-health.test.ts`): 33 pass / **1 fail** — the new regression test
(`regime:null, the real "Regime" factor's label IS the bare word "Regime" ...`) failed on
`thesisHealthUncalibrated(h)` returning `false` instead of the expected `true`.

GREEN (post-fix, stash restored): **34/34 pass** in `src/lib/swing/thesis-health.test.ts`.

`npx tsc --noEmit`: clean (exit 0).

Run with Node 20 (`/opt/nvm/versions/node/v20.20.2/bin`):
`npx tsx --experimental-test-module-mocks --test src/lib/swing/thesis-health.test.ts`.

### Fix

Added the literal value of `SWING_PILLAR_LABELS.REGIME` (imported, not a second hardcoded "Regime"
string that could drift from it) to `UNCALIBRATED_PILLAR_LABELS.regime`'s array:

```ts
regime: [BANGER_LEDGER_REGIME_LABEL, "unread", SWING_PILLAR_LABELS.REGIME],
```

This gives the bare-"Regime" fallback the exact same downstream treatment the `"unread"` and
Banger-sentinel cases already get — confirmed by reading both consumers before fixing:
`thesisHealthUncalibrated()` trips the aggregate-withhold guard (the blended health % is not shown
for the whole position), and `calibratedThesisPillars()` excludes only this one pillar from the
per-pillar breakdown while keeping the other four genuinely-calibrated pillars (persistence,
entry_geometry, flow_corroboration, theta_budget) — matching the existing behavior for the AAPL
position-40 "unread" case (2026-09-22), not the broader Banger-ledger "drop everything" case (which
is triggered by a different, independent check — the Banger sentinel on `regimePillar.currentLabel`
inside `calibratedThesisPillars` itself — and is unaffected by this change).

Also corrected the now-stale closing sentence of #6931's own doc comment above `regimeScore()`,
which claimed the fix "never needs its own new sentinel, only a correct lookup" — that turned out
to be incomplete, exactly as this finding demonstrates.

### Blast radius

One file (`thesis-health.ts`), one array entry. The swing-only `regimeScore()`/
`UNCALIBRATED_PILLAR_LABELS` pattern has no counterpart in the sibling `src/lib/zerodte/
thesis-health.ts` (grepped — no match), so there is no second call site carrying the identical
latent bug. Every consumer of `thesisHealthUncalibrated()`/`calibratedThesisPillars()` benefits
from this fix, most directly `play-brief.ts`'s "Thesis health" section (`src/lib/swing/
play-brief.ts` ~lines 171/180), the one place that currently reads both.
