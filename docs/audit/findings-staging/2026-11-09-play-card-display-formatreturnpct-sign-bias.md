## `formatReturnPct` (play-card-display.ts) had the same sign-bias rounding tie as fmtPct/shift-math/signPct — Peak/Trough/P&L/stock-move stats silently understated by 1pt at .5 boundaries

> **kind:** `FINDING`

### Summary
`JavaScript.Math.round()` always rounds a `.5` tie toward `+Infinity`
(`Math.round(-2.5) === -2` but `Math.round(2.5) === 3`). Any formatter that applies a bare
`Math.round(n)` to a value that can be negative, while deciding the `+`/`-` sign prefix with a
separate comparison, silently rounds a negative reading's MAGNITUDE down at the `.5` boundary —
a real `-2.5%` loss prints as `-2%`, one point smaller in magnitude than it actually is, while
the same-magnitude positive reading (`2.5%`) correctly rounds away from zero to `+3%`.

`formatReturnPct` (`src/features/nighthawk/command-deck/play-card-display.ts`) had exactly this
shape:

```ts
export function formatReturnPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : ""}${Math.round(n)}%`;
}
```

This is a shared, EXPORTED formatter (unlike the prior fixes to inline `signPct` helpers), used
across the whole Night Hawk command deck for several real, often-negative fields:
- `CommandDeck.tsx` — Peak Return (`p.peak`, CLOSED rows), Since-flag track % (`p.trackPct`,
  WATCH/SKIP rows), stock-move % (`p.stockMovePct`), and live P&L % (`p.pnlPct`).
- `PlayLifecycleCard.tsx` — the lifecycle card's return number.
- `TerminalPremiumPanels.tsx` — `summary.currentPct` and `summary.peakPct`.

This is a TENTH confirmed instance of the identical bug class, previously found and fixed
independently in `fmt-money.ts`'s `fmtPct`, `round-floats.ts`, `thermal/lib/gex-heatmap/
shift-math.ts`'s `fmtShiftPercentForStrike`, and two local `signPct` duplicates in this very
`command-deck/` directory (`PlayTerminal.tsx`, `ZeroDteCommandPanel.tsx`, #7674/#7676) —
`formatReturnPct` is a THIRD, separately-named, exported formatter in the same directory that
none of those fixes reached, because it is neither of the two `signPct` names a name-grep for
"already fixed" would have found.

### Evidence
RED repro (pre-fix), added to `play-card-display.test.ts`:
```ts
it("formatReturnPct: a tie above zero and the mirror tie below zero round to the SAME magnitude", () => {
  assert.equal(formatReturnPct(2.5), "+3%", "positive tie rounds away from zero");
  assert.equal(formatReturnPct(-2.5), "-3%", "mirror-image tie must round to the same magnitude");
});
```
`Math.round(-2.5)` evaluates to `-2` in V8 (confirmed directly in the Node REPL: `node -e
"console.log(Math.round(-2.5), Math.round(2.5))"` → `-2 3`). Test run pre-fix: `9 tests, 1 fail`
(the new test — `formatReturnPct(-2.5)` returned `"-2%"`, not the expected `"-3%"`). Post-fix:
`9 tests, 0 fail`.

### Fix
`Math.sign(n) * Math.round(Math.abs(n))` instead of a bare `Math.round(n)` — rounds the
magnitude correctly regardless of sign (ties always round away from zero), leaves exact integers
and positive values byte-identical to before (including the two pre-existing
`formatReturnPct(87) === "+87%"` / `formatReturnPct(-12) === "-12%"` assertions, still green),
and matches the exact fix pattern already applied at every prior instance of this bug class.

### Fix rationale
Matching the already-established, reviewed fix shape for this exact bug class (rather than
inventing a new one) keeps every "round a signed delta/points/percent value for display" call
site in this codebase consistent.

### Blast radius
One shared helper, four real consumer sites across three files (`CommandDeck.tsx` ×4 fields,
`PlayLifecycleCard.tsx`, `TerminalPremiumPanels.tsx` ×2) — every one of them renders a value that
can legitimately be negative on a real losing/declining position, so every one was silently
understating a negative magnitude by up to 1 point exactly at the `.5` boundary. No other
exported formatter in `play-card-display.ts` shares this shape (`playQualityPct`,
`tierStarCount` both clamp to non-negative ranges before rounding, so the sign-bias tie cannot
occur there).

### Why this wasn't caught by the prior nine fix-passes
Every prior fix in this bug class targeted a shared, IMPORTED helper (`fmtPct`,
`fmtShiftPercentForStrike`) or an inline, locally-scoped `signPct` function living directly
inside a `.tsx` component. `formatReturnPct` is a third shape: an EXPORTED, differently-named
pure function in a sibling `.ts` file one directory over from the two already-fixed `signPct`
instances — close enough that a human skim of "the command-deck formatters" could plausibly
assume it was covered by the `signPct` sweep, but a literal grep for the function name `signPct`
would never surface it. Confirms the standing lead from the prior rounds: this bug class needs a
SHAPE grep (bare `Math.round(n)` paired with a separate sign-ternary) across the whole `src/`
tree, not a name grep for known-buggy helper names.

| **Status** | FIXED — this PR. |
