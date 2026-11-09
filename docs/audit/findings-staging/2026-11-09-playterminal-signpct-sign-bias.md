> **kind:** FINDING

## Night Hawk command-deck `signPct` was a sixth un-migrated copy of the signed-percentage sign-bias rounding bug — FIXED

| **Status** | FIXED |
|---|---|
| **Severity** | P3 (display-only; live member-facing P&L figures) |
| **Area** | `src/features/nighthawk/command-deck/PlayTerminal.tsx` |

### Root cause

`fmt-money.ts`'s `fmtPct` header already documents this exact bug class as having shipped
independently, byte-identical modulo nullability, in at least four files (`play-brief.ts`,
`play-brief-narrative.ts`, `play-brief-narrative-coaching.ts`, `play-brief-intel.ts`), and
`thermal/lib/gex-heatmap/shift-math.ts`'s `fmtShiftPercentForStrike` names itself as a fifth,
independently-pasted instance missed by both prior sweeps:

Plain `Math.round(n)` ties toward `+Infinity` (`Math.round(-2.5) === -2` but
`Math.round(2.5) === 3`). Any signed-percentage formatter that rounds the raw signed value and
then separately checks `n > 0` for the `+`/`-` prefix inherits this asymmetry: a NEGATIVE value
sitting exactly on a whole-percent tie rounds to a SMALLER magnitude than the IDENTICAL positive
magnitude. For a trading desk this specifically understates losses relative to the mirror-image
gain — a losing position's displayed drawdown reads smaller than it really is.

`PlayTerminal.tsx` (Night Hawk's command-deck play detail view) had its own, independent copy:

```ts
const signPct = (n: number | null | undefined): string =>
  (n != null ? `${n > 0 ? "+" : ""}${Math.round(n)}%` : "—");
```

This is used for two live, member-facing figures:
- `TradeOutcomePanel`'s **Peak**/**Trough** chips (`play.peak` / `play.trough` — the trade's own
  intraday high/low P&L%, rendered with `nh-deck-pos`/`nh-deck-neg` classes) — `trough` is the one
  most likely to land on a real negative tie, since it is the drawdown figure.
- `formatScorecardHint`'s `avg` figure (the conviction-bucket/play average return% hint shown
  next to a play's thesis rank).

Neither call site rounds or clamps its input beforehand, so a real P&L% or average arriving at an
exact half-percent (e.g. -2.5%, -0.5%) hits the bias directly.

### Evidence (RED → GREEN)

New test file `src/features/nighthawk/command-deck/play-terminal-signpct.test.ts`, following the
existing `play-terminal-etclock.test.ts` precedent of unit-testing an exported pure helper
straight out of `PlayTerminal.tsx` (exported `signPct` for this; no other change to its call
sites, signature, or output shape beyond the fix itself).

Pre-fix (RED), reproduced by exporting `signPct` unchanged and running the new test:

```
not ok 1 - PlayTerminal signPct: equal-magnitude positive/negative ties render the SAME magnitude
  Expected values to be strictly equal:
  '-2%' !== '-3%'
```

(`signPct(2.5)` → `"+3%"`, `signPct(-2.5)` → `"-2%"` — a 1-point magnitude gap on an identical
distance from zero.)

Post-fix (GREEN): all 3 new tests pass (ties, ordinary non-tie values, zero/null/undefined), plus
the pre-existing `play-terminal-etclock.test.ts` (3 tests) and `PlayTerminal.ssr.test.ts` (34
tests) still pass unchanged — 40/40. `npx tsc --noEmit` clean.

### Blast radius

`signPct` has exactly two call sites, both inside `PlayTerminal.tsx` (`TradeOutcomePanel`'s
Peak/Trough chips via a prop, and `formatScorecardHint`). No other file imports or re-implements
this exact formatter — checked via repo-wide grep for the same `n > 0 ? "+" : ""` + bare
`Math.round` shape; the other hits from that grep (`fmt-money.ts`'s `fmtPct`, `round-floats.ts`,
`shift-math.ts`'s `fmtShiftPercentForStrike`) are the three already-fixed siblings this finding
names above, not new instances.

### Fix rationale

Same fix as the three prior siblings: round by magnitude, then reapply sign
(`Math.sign(n) * Math.round(Math.abs(n))`), so both signs tie the same direction (away from
zero). Kept local to `PlayTerminal.tsx` rather than switching the call sites to import
`fmt-money.ts`'s `fmtPct` — that helper takes a `digits` precision and always appends exactly
`%`, but `fmtPct`'s digits=0 output format otherwise matches `signPct`'s existing output
(`${sign}${magnitude}%`), so this is a deliberate, minimal, in-place fix matching the same
diff shape `shift-math.ts`'s own fix used, not a refactor to a shared import. Output format
(no decimal digits, `+`/`-` prefix convention, `"—"` for null/undefined) is otherwise unchanged.
