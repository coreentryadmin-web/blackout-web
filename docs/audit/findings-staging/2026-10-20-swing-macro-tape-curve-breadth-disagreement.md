## A swing play-brief's macro-tape coaching line silently dropped an inverted yield curve whenever breadth read risk-on, instead of naming the disagreement — FIXED

> **kind:** `FINDING`

| **Status** | Fixed |
|---|---|

**Found:** 2026-10-20, Ask Largo standing mandate — a narrative-quality pass over
`play-brief-narrative-coaching.ts` against `docs/audit/LARGO-PRODUCT-CONTRACT.md`'s "disagreement is
represented, never reconciled by the lanes themselves" principle.

**Root cause:** `macroTapeCoaching` (`src/lib/swing/play-brief-narrative-coaching.ts`) renders both
the 10Y yield/curve spread and market-breadth tone as sibling facts in one bullet
(`**Macro tape** — 10Y X% · curve Y · breadth Z.`), but its synthesized "hint" sentence keyed
**only** off `arsenal.breadth?.tone`, never the curve value. A curve inversion
(`curve_10y_1y_spread < 0` — the exact convention already used for this same field in
`verdict-core.ts` and `ecosystem-narrative.ts`, where it's rendered with an explicit `"(inverted)"`
marker) is itself a distinct, well-known risk-off macro signal. When breadth read "risk-on" alongside
an inverted curve, the hint fell through to the generic "shorts face headwind" framing (or, for a
LONG play with neither direction match, the bare "not a trigger" filler) — silently discarding the
curve's own risk-off read rather than naming that the two macro facts, presented in the SAME bullet,
actually disagreed. Separately, the curve figure itself was never marked `"(inverted)"` in this
bullet at all (unlike the two sibling call sites for the identical field), so a reader could not even
tell from the bullet text alone that the curve was inverted.

**Live impact:** reachable on any swing play-brief for a ticker carrying both a macro read and a
breadth read with an inverted curve — not an edge case; yield-curve inversions are a recurring macro
regime, not a rare one-off.

**Fix:**
- `macroTapeCoaching`'s curve bullet now appends `"(inverted)"` when `curve_10y_1y_spread < 0`,
  reusing the exact convention already established elsewhere rather than inventing a new threshold.
- Added a `curveBreadthDisagree` check (`curveInverted && riskOn`) that fires **before** the existing
  direction-based branches and replaces the hint with an explicit tension sentence ("the two macro
  reads disagree; treat this as genuine tension, not a clean risk-on signal") instead of silently
  picking breadth's side. The pre-existing branches (LONG+risk-off, SHORT+risk-on without inversion,
  generic fallback) are untouched — this is additive, not a rewrite of the function's heuristics.

**Fix rationale:** Followed the same "surface disagreement, don't flatten it" discipline this file's
own `crossDeskCoaching` (cross-desk friction) and `counterThesisLine` already apply to conflicting
signals — scoped narrowly to the one case this function was actually dropping a real signal (inverted
curve + risk-on breadth), rather than redesigning every branch of the hint logic. Did not touch
`arsenal.macro`/`arsenal.breadth` themselves or any other reader of these fields.

**Blast radius:** single call site (`macroTapeCoaching`, one `push(macroTapeCoaching(ctx))` caller in
`collectCoachingBullets`). No other function reads `arsenal.macro`/`arsenal.breadth` through this
same hint logic.

**Tests:** 4 new regression tests — inverted curve + risk-on breadth now surfaces the disagreement
(and no longer emits the single-signal SHORT hint); non-inverted curve + risk-on breadth keeps the
existing SHORT headwind framing unchanged; inverted curve + risk-off breadth (agreeing signals) keeps
the existing LONG tighter-stops framing unchanged; no macro/breadth data returns `null`. RED→GREEN
proven via `git stash` (2/4 fail pre-fix — the two behavior-preserving regression guards correctly
pass both before and after). `tsc --noEmit` clean. Full suite green on Node 20.
