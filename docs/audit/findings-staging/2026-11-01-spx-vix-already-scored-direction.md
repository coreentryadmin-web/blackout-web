> **kind:** FINDING

# SPX `vixAlreadyScored()` suppressed the VIX-extreme conflict bonus on presence, not opposition — same bug class as the already-fixed GEX guard (#7114)

| | |
|---|---|
| **Area** | SPX Slayer (`src/features/spx/lib/spx-play-conflicts.ts`, `computeWeightedConflicts`) |
| **Severity** | P2 — `weighted_conflicts` feeds the "Tape's mixed" gate warning/block threshold and the full/starter entry `conflictMax` gates (`spx-play-gates.ts`); a real, independent conflict was silently dropped, letting a setup that should have been flagged (or blocked) pass gates as if it had one fewer conflict than it really does |
| **Status** | FIXED — PR open (`fix/spx-vix-already-scored-direction`) |

## Root cause

`vixAlreadyScored()` suppressed `computeWeightedConflicts()`'s `vixExtremeAgainst()` +2 desk-level
conflict bonus whenever **any** VIX-family factor existed in `factors`, regardless of which side
it agreed with:

```ts
function vixAlreadyScored(factors: SpxSignalFactor[]): boolean {
  return factors.some((f) => f.label.includes("VIX") || f.label === "IV rank");
}
```

`desk.vix` (the absolute VIX level `vixExtremeAgainst()` reads) and the `"VIX curve"` factor
(`spx-signals.ts`, built from `vix_term`'s `vix9d`/`vix3m` term-structure shape) are **independent
metrics computed from independent inputs** — one is the spot VIX print, the other is the 9-day vs
3-month term-structure slope. `"VIX curve"` can carry a **positive** weight (contango, agreeing
with a long) at the exact same time `desk.vix` is extreme (>28) and genuinely **opposes** that
same long. The broad presence-only guard read "a VIX-family factor exists" as "the VIX-extreme
conflict is already counted" and dropped the real, independent conflict.

This is the identical bug class PR #7114 already fixed for GEX in this same file
(`gexAlreadyScored`), for the identical reason: `computeSpxConfluence`'s mutual-exclusivity fix
can leave only the *agreeing* GEX wall in `factors` while a real, unscored *opposing* wall exists
server-side — and the old broad guard there made the same presence-vs-opposition mistake. #7114's
fix was to check whether an existing factor actually **opposes** `direction` (`factorOpposes`,
already used by the main opposing-factor loop in this same function), not merely whether a
same-family factor exists at all. `vixAlreadyScored` was never given the equivalent fix.

`"IV rank"` (the guard's other branch) is **not** affected by this gap: `spx-signals.ts` only ever
pushes `"IV rank"` as an **opposing** factor (high IV rank fades a long, low IV rank squeezes a
short — see the `uw_iv_rank` block in `spx-signals.ts`), so "exists" and "exists and opposes" were
already equivalent for it. The fix had to preserve that behavior exactly rather than add a
conditional carve-out for it.

## Evidence

Live repro against the real imported `computeWeightedConflicts` (also now a regression test,
`spx-play-conflicts.test.ts`):

```js
// No VIX-family factor present -> correctly scores the VIX-extreme conflict:
computeWeightedConflicts({...desk, vix:30, vix_term:{vix9d:null,vix3m:null}}, 40,
  [{label:"Live tape", weight:12}])
// => { conflicts: 0, weighted_conflicts: 2 }   correct

// Same VIX=30 extreme-against-long, but an AGREEING "VIX curve" factor present (contango, +4):
computeWeightedConflicts({...desk, vix:30, vix_term:{vix9d:20,vix3m:22}}, 40,
  [{label:"Live tape", weight:12}, {label:"VIX curve", weight:4, detail:"contango"}])
// pre-fix => { conflicts: 0, weighted_conflicts: 0 }   BUG: real conflict silently dropped
// post-fix => { conflicts: 0, weighted_conflicts: 2 }  correct
```

Live production currently carries a real `"VIX curve"` factor (contango, weight +4) on SPX — only
`desk.vix` crossing above 28 while the term structure stays in contango was needed to trigger the
silent drop in production.

RED→GREEN proof (not just the final test run): reverted `spx-play-conflicts.ts` to its pre-fix
`origin/main` content while keeping the new tests, ran the suite — exactly 1 failure (the live-repro
case: expected `weighted_conflicts: 2`, got `0`), the other 9 tests (including the two guarding
against regressing the already-opposing-VIX-factor and `"IV rank"` cases) passed unchanged.
Restored the fix — all 10 pass. Full `src/features/spx/lib/*.test.ts` run: 921/921 pass.
`npx tsc --noEmit`: clean.

## Blast radius

`computeWeightedConflicts` is called from `spx-signals.ts` (`computeSpxConfluence`, the source for
both `GET /api/market/spx/desk` and `GET /api/market/spx/play`) and `spx-play-context.ts`. Its
`weighted_conflicts` output feeds:
- the "Tape's mixed" gate warning/block threshold, and
- the full/starter entry `conflictMax` gates in `spx-play-gates.ts`.

No other call site reads `vixAlreadyScored` directly — it is a private helper of this one function
— so the fix is contained to this single file, same as #7114's GEX fix was.

## Fix rationale

Applied the exact same pattern #7114 already established for `gexAlreadyScored`: require the
existing VIX-family factor to actually **oppose** `direction` (reusing `factorOpposes`, already
defined in this file and used by the main opposing-factor loop) before treating the desk-level
`vixExtremeAgainst()` bonus as already counted, instead of merely checking that a same-family
factor exists:

```ts
function vixAlreadyScored(factors: SpxSignalFactor[], direction: "long" | "short"): boolean {
  return factors.some(
    (f) => (f.label.includes("VIX") || f.label === "IV rank") && factorOpposes(direction, f)
  );
}
```

Deliberately left unchanged: `"IV rank"`'s own scoring logic in `spx-signals.ts` (it is only ever
pushed as an opposing factor there, so "exists" and "exists and opposes" already coincide for it —
adding separate-case complexity for a non-issue would be scope creep, not a fix). A regression test
confirms `"IV rank"` behavior is byte-identical pre/post fix.

## Tests

Added to `src/features/spx/lib/spx-play-conflicts.test.ts`:
1. The live-repro case above (VIX=30, agreeing `"VIX curve"` factor) — the bonus now fires
   (`weighted_conflicts` includes the +2).
2. A case where the VIX-family factor (`"VIX curve"`, backwardation) genuinely opposes
   `direction` — the bonus is still correctly suppressed, matching pre-fix behavior for the case
   `vixAlreadyScored` was originally designed for (no double-count).
3. The existing `"IV rank"`-present case — unaffected, still suppresses the bonus exactly as
   before (now also documents that `"IV rank"` is a *hard* opposing factor, so the main loop's own
   +2 contribution is unchanged by this fix).
