## Thermal Discord's own local `fmtShiftPct` had the same sign-bias rounding tie as fmtPct/shift-math's own `fmtShiftPercentForStrike` — melting put/call walls understated by 1pt at .5 boundaries in the live shift-leaders Discord line

> **kind:** `FINDING`

### Summary
`JavaScript.Math.round()` always rounds a `.5` tie toward `+Infinity`
(`Math.round(-2.5) === -2` but `Math.round(2.5) === 3`). Any formatter that applies a bare
`Math.round(n)` to a value that can be negative, while deciding the `+`/`-` sign prefix with a
separate `>= 0` comparison, silently rounds a negative reading's MAGNITUDE down at the `.5`
boundary — a real `-2.5%` melt prints as `-2%`, one point smaller in magnitude than it actually
is, while the identical-magnitude positive reading (`+2.5%` build) correctly rounds away from
zero to `+3%`.

`src/lib/thermal-discord-extras.ts` defines its own local `fmtShiftPct` helper with exactly this
shape:

```ts
function fmtShiftPct(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  return `${pct >= 0 ? "+" : ""}${Math.round(pct)}%`;
}
```

This formats the build/melt % shown for every strike in the Thermal Discord bot's live
"shift leaders" sub-line (`buildThermalShiftLeadersLine`, posted via
`buildThermalDiscordEmbedWithExtras` — a real, production Discord-posting path, not a dead or
admin-only surface), fed by `wallStrengthShift`'s signed `pct` (negative for every melting wall,
call or put side).

The sibling Thermal-desk file `src/features/thermal/lib/gex-heatmap/shift-math.ts` already fixed
the IDENTICAL bug in its own `fmtShiftPercentForStrike`, and that fix's own doc comment says so
explicitly: *"Same bug class already fixed in `fmt-money.ts`'s `fmtPct` (2026-10-26) and
`round-floats.ts`; **this sibling Thermal-desk formatter was missed in both passes**."* That
comment was written about the two UI consumers (`GexMatrixShiftBadge`, `GexShiftLeadersStrip`,
both of which use `.toFixed(0)`, which V8 already rounds symmetrically and so were never
affected) — but `thermal-discord-extras.ts`'s own `fmtShiftPct` is a THIRD, independent, still-
broken consumer of the same `wallStrengthShift`/`shiftPercentForStrike` family that neither of the
prior two fix-passes reached, because it is a locally-defined, un-shared duplicate rather than an
import of the already-fixed `fmtShiftPercentForStrike`.

### Evidence
RED repro (pre-fix), calling `fmtShiftPct` directly and via the real
`buildThermalShiftLeadersLine` entry point:
```
fmtShiftPct(-2.5)                                        -> "-2%"   (expected "-3%")
buildThermalShiftLeadersLine(melting put wall, pct=-2.5)  -> "_melt 95 (-2%)_"   (expected "-3%")
```
confirmed directly in the Node REPL (`Math.round(-2.5) === -2`, `Math.round(2.5) === 3`) and via
the regression tests added in this PR (`src/lib/thermal-discord-extras.test.ts`):
- `fmtShiftPct(2.5)` (positive boundary) renders `+3%` both before and after the fix — proving
  the fix changes only the negative-magnitude case, not the already-correct positive one.
- `fmtShiftPct(-2.5)` renders `-2%` pre-fix (FAILS), `-3%` post-fix (PASSES).
- A mirror-magnitude integration test through the real `buildThermalShiftLeadersLine` (a
  `+2.5%`-tie building call wall next to a `-2.5%`-tie melting put wall, same magnitude) renders
  `+3%`/`-2%` pre-fix — the two equal-magnitude opposite shifts visibly disagree — and `+3%`/`-3%`
  post-fix.
- A near-zero negative value (`-0.3`, rounds to magnitude 0) still renders the honest `0%`, never
  a misleading signed `-0%` — same guard the `shift-math.ts` fix already established, mirrored
  here.

Post-fix: 7/7 tests in `thermal-discord-extras.test.ts` pass (3 pre-existing build/melt-labeling
tests unaffected, 4 new sign-bias tests). `npx tsc --noEmit` clean. Sibling suites
(`thermal-discord-breach-state.test.ts`, `thermal-discord-breach-lock-concurrency.test.ts`) pass
unchanged.

### Fix
`Math.sign(pct) * Math.round(Math.abs(pct))` instead of a bare `Math.round(pct)` — rounds the
magnitude correctly regardless of sign (ties always round away from zero), leaves exact integers
and positive values byte-identical to before, and matches the exact fix pattern already applied
at every prior instance of this bug class (`fmtPct`, `round-floats.ts`, `shift-math.ts`'s own
`fmtShiftPercentForStrike`, and several Night Hawk command-deck `signPct`/`formatReturnPct`
instances). The sign-prefix comparison changed from `pct >= 0` (on the raw input) to
`rounded > 0` (on the rounded output, `> 0` not `>= 0`) so an exact zero or a magnitude that
rounds down to zero never prints a misleading `+0%`/`-0%` — the same convention
`fmtShiftPercentForStrike` and the already-fixed `ZeroDteCommandPanel.tsx`/`PlayTerminal.tsx`
`signPct` helpers use.

Also exported `fmtShiftPct` (was module-private) so it can be unit-tested directly, matching the
export convention `shift-math.ts` already uses for its own `fmtShiftPercentForStrike`.

### Blast radius
One file, one local helper, one call site (`buildThermalShiftLeadersLine`'s per-strike shift
line), one live production surface: the Thermal Discord bot's "full" embed shift-leaders
sub-line (`buildThermalDiscordEmbedWithExtras`, posted via `thermal-discord-run.ts`'s cron). No
other caller of `fmtShiftPct` exists (grep-confirmed). Deliberately NOT touching
`shift-math.ts`'s `fmtShiftPercentForStrike` (already fixed), `GexMatrixShiftBadge.tsx` /
`GexShiftLeadersStrip.tsx` (both use `.toFixed(0)`, never affected by this bug), or any other
file — this is the one remaining un-fixed consumer the prior fix's own comment named but did not
reach.

### Why this wasn't caught by the prior fix passes
The prior fix (`shift-math.ts`'s `fmtShiftPercentForStrike`) targeted the shared, canonical
helper and the two UI components that already imported a (different, `.toFixed`-based) local
formatter. `thermal-discord-extras.ts`'s `fmtShiftPct` is a third, differently-located, inline
function that happens to consume the same underlying `wallStrengthShift` data but was never
imported from or compared against the fixed helper — grepping for "already using
`fmtShiftPercentForStrike`" would have missed this as "already fixed"; only grepping for the
bare-`Math.round`-plus-sign-ternary SHAPE across the whole `src/` tree (continuing the standing
lead from prior rounds: local, non-shared formatters defined inline inside files not yet read
line-by-line survive a central-helper fix) surfaces it.

| **Status** | FIXED — this PR. |
