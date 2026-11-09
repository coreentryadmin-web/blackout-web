> **kind:** FINDING

## Night Hawk Debrief module's shared `round2` helper was the 12th confirmed instance of the signed-value sign-bias rounding bug — FIXED

| **Status** | FIXED |
|---|---|
| **Severity** | P3 (display/classification; feeds the per-play post-mortem excursion numbers and the lucky-win/wrong-direction taxonomy thresholds) |
| **Area** | `src/features/nighthawk/lib/debrief.ts` (`round2`, used by every `pctOf`-derived percentage in the module) |

### Root cause

Plain `Math.round(n * 100) / 100` ties toward `+Infinity` (`Math.round(-12.5) === -12` but
`Math.round(12.5) === 13`, the same asymmetry already documented and fixed in `fmt-money.ts`'s
`fmtPct`). Any rounding helper built this way inherits a direction-biased asymmetry: a NEGATIVE
value sitting exactly on a 2dp tie boundary rounds to a SMALLER magnitude than the IDENTICAL
positive magnitude would.

`debrief.ts` defined its own local copy of this shape:

```ts
const round2 = (n: number): number => Math.round(n * 100) / 100;

function pctOf(base: number, move: number): number {
  return round2((move / base) * 100);
}
```

`pctOf` is the ONLY percentage-rounding primitive in the whole module — it computes
`mfe_pct`/`mae_pct`/`target_distance_pct`/`stop_distance_pct` in `computeExcursion`, the
close-to-close `movePct` in the "direction" thesis factor, and the overnight-gap `gapPct` in the
"catalyst" thesis factor in `buildThesisScorecard`. Every one of those values is a magnitude that
can legitimately be negative (an adverse excursion, a down move, a gap against the play), so
every one of them inherited the asymmetry.

Concretely reachable with an entirely ordinary daily range: a $32 fill price with session high
$33 / low $31 — a perfectly symmetric $1 move EACH WAY from the identical entry — computed
`mfe_pct: 3.13` but `mae_pct: -3.12` for the exact same $1 distance, because `pctOf(32, 1)`
raw-rounds `3.125` UP to `3.13` while `pctOf(32, -1)` raw-rounds `-3.125` only DOWN to `-3.12`.
This is not merely a cosmetic one-hundredth-of-a-percent label: `mfe_vs_target_ratio` and
`mae_vs_stop_ratio` are derived directly from these two numbers and are compared against the
module's own named classification thresholds (`LUCKY_WIN_MAE_STOP_FRACTION = 0.75`,
`WRONG_DIRECTION_MFE_TARGET_FRACTION = 0.25` in `classifyFailureMode`) — a borderline play sitting
exactly on one of those thresholds could tip into the wrong failure-mode tag (e.g. `lucky_win`
vs `clean_win`, or `wrong_direction` vs `stopped_normal`) purely because the adverse side of its
own excursion was asymmetrically shrunk relative to the favorable side.

This is the **12th confirmed instance** of this bug class in this codebase, following
`fmt-money.ts`'s `fmtPct`, `round-floats.ts`, `thermal/lib/gex-heatmap/shift-math.ts`'s
`fmtShiftPercentForStrike` (and its sibling `fmtShiftPct` in `thermal-discord-extras.ts`,
PR #7690), this same feature's command-deck siblings (`PlayTerminal.tsx` /
`ZeroDteCommandPanel.tsx`'s shared `signPct` shape), `format.ts`'s "Net VEX" line, and
`formatReturnPct` (PR #7687) — confirming once more that grepping by function NAME misses
instances; the bare-`Math.round` + raw-multiply-then-divide SHAPE is what has to be searched for,
and it had survived here specifically because `round2`/`pctOf` are local, unexported helpers that
none of the prior sweeps' call-site greps for `fmtPct`/`signPct`/`Math.round(` with a `+`/`-`
ternary nearby happened to walk into (this file's sign-prefix ternaries read off the already
-rounded `pctOf` output, e.g. `movePct >= 0 ? "+" : ""`, which is the CORRECT half of the fix — the
bug was entirely upstream, inside `round2` itself, not in how the sign prefix was chosen).

### Evidence (RED → GREEN)

Extended `src/features/nighthawk/lib/debrief.test.ts` with a new test exercising the real,
exported `computeExcursion`/`computeFill` through a minimal fixture row — no fields faked beyond
what the functions actually read — both LONG and SHORT, both built with the module's existing
`row()` fixture helper:

```ts
test("MFE/MAE magnitudes match for a perfectly symmetric excursion (sign-bias rounding tie)", () => {
  const symRow = row({ entry_range_high: 32, next_day_open: 32, session_high: 33, session_low: 31, ... });
  const sym = computeExcursion(symRow, computeFill(symRow))!;
  assert.equal(sym.mfe_pct, 3.13);
  assert.equal(sym.mae_pct, -3.13); // magnitude must equal mfe_pct's 3.13, not 3.12
  ...
});
```

Pre-fix (RED), reproduced by reverting only the `round2` line and re-running the new test against
the otherwise-unchanged source:

```
not ok 28 - MFE/MAE magnitudes match for a perfectly symmetric excursion (sign-bias rounding tie)
  Expected values to be strictly equal:
  -3.12 !== -3.13
```

Post-fix (GREEN): all 37 tests in `debrief.test.ts` pass (the new test plus every pre-existing
one, including the real-history AMD/DELL fixtures), plus the sibling `debrief-aggregate.test.ts`
+ `debrief-persist.test.ts` (49 tests) still pass unchanged. `npx tsc --noEmit` clean.

### Blast radius

`round2`/`pctOf` are the sole percentage-rounding path for this entire module — every consumer of
`computeExcursion` (`mfe_pct`, `mae_pct`, `target_distance_pct`, `stop_distance_pct`, and the two
ratios derived from them) and every consumer of `buildThesisScorecard`'s `movePct`/`gapPct`
inherits the fix automatically, with no other call site to touch (checked via grep: `round2`/
`pctOf` have no duplicate copies elsewhere in the module or in `debrief-aggregate.ts`/
`debrief-persist.ts`, which only consume the already-computed `PlayDebrief` output, never
re-round anything themselves). `debriefRealizedReturnPct` is unaffected — it intentionally returns
the raw, unrounded close-vs-entry percentage (callers round it separately with the module's own
`round2`, which is now fixed at that call site too).

### Fix rationale

Same fix as every prior sibling in this bug class: round by magnitude, then reapply sign
(`Math.sign(n) * Math.round(Math.abs(n) * 100)) / 100`). Kept local to `debrief.ts`'s own
`round2` (not refactored into an import from `fmt-money.ts` or elsewhere) because the module is
explicitly documented as pure/I/O-free at runtime and already defines its own small rounding
helper rather than depending on another feature's formatter — matching the minimal, in-place diff
shape every prior sibling fix in this bug class used. Output format, precision (2dp), and every
other call site's behavior are otherwise unchanged; the sign-prefix ternaries throughout the file
(`movePct >= 0 ? "+" : ""`, etc.) were already correctly reading off the rounded value and needed
no change.
