## ZeroDteCommandPanel's own local `signPct` had the same sign-bias rounding tie as fmtPct/shift-math/PlayTerminal — negative Trough/Realized/Peak stats silently understated by 1pt at .5 boundaries

> **kind:** `FINDING`

### Summary
`JavaScript.Math.round()` always rounds a `.5` tie toward `+Infinity`
(`Math.round(-2.5) === -2` but `Math.round(2.5) === 3`). Any formatter that applies a bare
`Math.round(n)` to a value that can be negative, while deciding the `+`/`-` sign prefix with a
separate comparison, silently rounds a negative reading's MAGNITUDE down at the `.5` boundary —
i.e. a real `-2.5%` loss prints as `-2%`, one point smaller in magnitude than it actually is,
while the same-magnitude positive reading (`2.5%`) correctly rounds away from zero to `3%`.

`ZeroDteCommandPanel.tsx` (`src/features/nighthawk/command-deck/`) defines its own local
`signPct` helper with exactly this shape:

```ts
const signPct = (n: number | null | undefined): string =>
  n != null ? `${n > 0 ? "+" : ""}${Math.round(n)}%` : "—";
```

It formats three real, often-negative fields on the Night Hawk command-deck panel:
- `play.trough` — the mechanical worst-excursion read, always `<= 0`, rendered with the
  `nh-deck-neg` class ("Trough" row).
- `realizedPct` — the as-managed realized P&L for a CLOSED position, negative for a losing trade
  ("Realized" row).
- `play.peak` — usually positive but not guaranteed to be.

This is now a SEVENTH confirmed instance of the identical bug class, previously found and fixed
independently in `fmt-money.ts`'s `fmtPct`, `round-floats.ts`,
`thermal/lib/gex-heatmap/shift-math.ts`, and (most recently, a different file with the SAME
duplicate-named `signPct` helper) `PlayTerminal.tsx`'s own formatter — a sibling file in the same
`command-deck/` directory that the `PlayTerminal.tsx` fix did not reach, because the two
`signPct` definitions are independent, un-shared, locally-scoped functions rather than one
exported helper.

### Evidence
RED repro (pre-fix), rendering `ZeroDteCommandPanel` with `trough: -2.5`:
```
Trough rendered: -2%   (expected -3%)
```
`Math.round(-2.5)` evaluates to `-2` in V8, confirmed directly in the Node REPL and via the
regression test added in this PR
(`src/features/nighthawk/command-deck/ZeroDteCommandPanel.test.ts`, new `describe` block
"signPct does not understate negative magnitudes at the .5 rounding boundary"):
- `trough: -2.5` must render `-3%`, not `-2%` — FAILS pre-fix, PASSES post-fix.
- `peak: 2.5` (positive boundary, should be unaffected) still renders `+3%` both before and
  after the fix, proving the fix changes only the negative-magnitude case.

Post-fix: 9/9 tests in `ZeroDteCommandPanel.test.ts` pass; full `src/features/nighthawk/
command-deck/*.test.ts` suite (417 tests across 14 suites, 492 individual assertions) passes
with no regressions. `npx tsc --noEmit` clean.

### Fix
`Math.sign(n) * Math.round(Math.abs(n))` instead of a bare `Math.round(n)` — rounds the
magnitude correctly regardless of sign (ties always round away from zero), leaves exact integers
and positive values byte-identical to before, and matches the exact fix pattern already applied
at every prior instance of this bug class (`fmtPct`, `round-floats.ts`, `shift-math.ts`,
`PlayTerminal.tsx`'s `signPct`).

### Blast radius
One file, one local helper, three call sites inside it (`realizedPct`/`play.peak`/`play.trough`,
lines 235/242/393/399 pre-fix). Deliberately NOT touching `PlayTerminal.tsx`'s own `signPct`
(already fixed in a separate, concurrently-open PR, #7674) or any shared formatter — this is a
second, independent local duplicate of the same shape, not a shared-helper regression.

### Why this wasn't caught by the prior five fix-passes
Every prior fix targeted a shared, IMPORTED helper (`fmtPct`, `round5`-style modules) or a single
`.tsx` file's own inline formatter. `signPct` here is a second, differently-located, inline
function with the identical name and bug as `PlayTerminal.tsx`'s own — grepping for the function
NAME would have missed this as "already fixed"; only grepping for the bare-`Math.round`-plus-
sign-ternary SHAPE across the whole `src/` tree surfaces it. Confirms the standing lead from the
prior round: local, non-shared formatters defined inline inside `.tsx` component files are
exactly the instances that survive a central-helper fix.

| **Status** | FIXED — this PR. |
