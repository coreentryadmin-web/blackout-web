> **kind:** `FINDING`

## Swing thesis-health `regimeScore()` borrowed a DIFFERENT pillar's factor/label whenever `regime` was null and that pillar happened to score higher than the real "Regime" factor — FIXED

| | |
|---|---|
| **Severity** | P2 (fabricated-looking calibrated read under the "Regime fit" heading — a member-facing correctness defect in Ask Largo's Thesis Health panel for swing positions, same C6-violation class as the Banger-ledger regime sentinel bug this file's own header comment already documents) |
| **Surface** | `src/lib/swing/thesis-health.ts` — `regimeScore()`, consumed by `computeSwingThesisHealth()` and rendered by `src/features/nighthawk/command-deck/ThesisHealthPanel.tsx` |
| **Status** | FIXED |

### Root cause

`regimeScore()` took the factor to borrow a label/score boost from by raw array position:

```ts
const top = factors?.[0];
```

`factors[]` is **not** an arbitrary-order array — `contributionsToFactors()` in
`src/lib/swing/swing-pillars.ts` sorts it `.sort((a, b) => b.points - a.points)` before this
function ever sees it, specifically so the desk/Ask Largo can show "biggest lever first." So
`factors?.[0]` is whichever pillar (Structure, Flow, Rel. strength, …) happened to score the
**most points for this specific position** — almost never actually the pillar labeled `"Regime"`.

When `regime` (the live/commit-time regime string) was null, the old code treated this
highest-scoring, arbitrary-identity factor as if it *were* the regime read:

```ts
const factorBoost = top && top.points > 0 ? Math.min(0.2, top.points / 100) : 0;
const score = clamp01(base + factorBoost);
return { commit: score, current: score, label: regime ?? (top ? top.label : "unread") };
```

Live repro (as reported): a position with `regime: null` and a real
`{"label":"Regime","points":10.4}` entry present in `factors[]` — genuinely scored, genuinely
real — but **outranked** by another pillar's higher-point factor (e.g. `{"label":"Structure",
"points":20.5}`). The real "Regime" factor was never consulted at all; instead the function
produced something like `{label:"Regime fit", currentLabel:"Structure", currentScore:0.65,
status:"intact"}` — a green, 65%-filled progress bar rendered under the **"Regime fit"** heading
in the Thesis Health panel, showing **Structure's** label and borrowing **Structure's** points for
the score boost. A member reading that panel has no way to tell the bar is describing a different
pillar entirely — the heading says "Regime fit," the content is "Structure."

This is the same failure shape `UNCALIBRATED_PILLAR_LABELS`/`thesisHealthUncalibrated()`
(this file, see their own header comments) were built to catch for the Banger-ledger stamped-
constant sentinel and the generic "unread" default — but neither of those sentinels matches
`"Structure"` (or whichever pillar happens to win), because this isn't a *missing*-input case, it's
a *wrong-identity* case: real data, attached to the wrong pillar's name. The sentinel guard was
never going to catch it because the bug is upstream of the guard — in which VALUE gets labeled
`"Regime fit"` in the first place, not in whether that value looks like a known placeholder.

### Evidence

New tests in `src/lib/swing/thesis-health.test.ts` (describe block: `regimeScore() consults the
factor actually labeled "Regime", never factors[0] by array position`):

1. `regime:null`, `factors` = `[{label:"Structure",points:20.5}, {label:"Regime",points:10.4}]` —
   the real "Regime" factor is present but is **not** `factors[0]` (Structure outscores it). Must
   render `currentLabel: "Regime"` (the real factor, correctly consulted), never `"Structure"`
   (the higher-scoring pillar's identity).
2. `regime:null`, `factors` = `[{label:"Structure",...}, {label:"Flow",...}]` — **no** factor is
   actually labeled "Regime" anywhere in the array. Must fall through to the honest `"unread"`
   uncalibrated default (which `thesisHealthUncalibrated()` already recognizes and withholds from
   the calibrated blend), never substitute the top-scoring pillar's label.

RED→GREEN confirmed via a scoped revert of `regimeScore()` alone (test file untouched,
`factors?.find(...)` reverted back to `factors?.[0]`):
- **Before the fix:** 2 failures — exactly the two new tests above (31/33 pass).
- **After the fix:** 33/33 pass.

Full suite: `npx tsx --experimental-test-module-mocks --test src/lib/swing/*.test.ts` — **2146/2146
pass** (Node 20.20.2). `npx tsc --noEmit` — clean, no new diagnostics.

### Blast radius

Single call site: `regimeScore()` is only called from `computeSwingThesisHealth()` in this same
file, which is the sole producer of the swing `ThesisHealthPayload` the Thesis Health panel (and
any Ask Largo play-brief section reading `h.pillars`) renders. No other function in the codebase
reads `factors?.[0]` for this purpose. `UNCALIBRATED_PILLAR_LABELS`/`thesisHealthUncalibrated()`/
`calibratedThesisPillars()` are unchanged — the fix corrects which value `regimeScore()` produces,
not how downstream code decides whether that value is calibrated; the existing "unread" sentinel
already does the right thing once `regimeScore()` honestly reaches it only when no real "Regime"
factor exists.

### Fix rationale

Changed the lookup from array-position to identity:

```ts
const top = factors?.find((f) => f.label === SWING_PILLAR_LABELS.REGIME);
```

`SWING_PILLAR_LABELS.REGIME` (imported from `./swing-pillars`, the same module that builds and
sorts `factors[]` in the first place) is reused rather than a second hardcoded `"Regime"` string
literal, so the two can never drift apart if the label is ever renamed. Everything else in
`regimeScore()` — the score formula, the "unread" fallback when no real match exists, the function
signature — is unchanged; this is a one-line lookup fix, not a rework of the scoring logic. No gate,
weight, or rendering behavior changed for the (already-correct) case where a real "Regime" factor
happens to also be the highest-scoring one, or where `regime` itself is non-null.
