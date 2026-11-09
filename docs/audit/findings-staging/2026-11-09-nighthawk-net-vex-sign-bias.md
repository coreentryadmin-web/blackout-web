> **kind:** FINDING

## Night Hawk dossier-text "Net VEX" line was a seventh un-migrated copy of the signed-value sign-bias rounding bug — FIXED

| **Status** | FIXED |
|---|---|
| **Severity** | P3 (display-only; feeds the live member/Largo-facing dossier text) |
| **Area** | `src/features/nighthawk/lib/format.ts` (`formatTickerDossierText`) |

### Root cause

Plain `Math.round(n)` ties toward `+Infinity` (`Math.round(-2.5) === -2` but
`Math.round(2.5) === 3`). Any formatter that rounds the raw signed value and then separately
checks the RAW value's sign for the `+`/`-` prefix inherits this asymmetry: a NEGATIVE value
sitting exactly on a whole-unit tie rounds to a SMALLER magnitude than the IDENTICAL positive
magnitude would.

`formatTickerDossierText`'s "Net VEX" line had its own, independent copy of this exact shape:

```ts
if (pos.net_vex != null) lines.push(`Net VEX: ${pos.net_vex >= 0 ? "+" : ""}${Math.round(pos.net_vex)}`);
```

`pos.net_vex` is a real net vanna-exposure figure (`PositioningSummary.net_vex`, sourced from
`gex-positioning.ts`/`polygon-options-gex.ts`'s GEX bundle). `formatTickerDossierText` builds the
per-ticker dossier TEXT block that is fed both into the Night Hawk overnight edition builder
(`edition-builder.ts`) and directly into Largo's play-explainer tool (`play-explainer.ts`) — i.e.
this string is what a member or Largo actually reads, not an internal intermediate value. A net
VEX of, say, -2.5 (in whatever display unit the upstream bundle already scaled it to) rendered
`"Net VEX: -2"` pre-fix instead of the correct `"Net VEX: -3"` — understating a short-vanna read
by exactly the same one-unit gap the six prior instances of this bug class produced, right where
a trader or Largo is reading the dealer-positioning narrative.

This is the SEVENTH confirmed instance of this bug class in this codebase, following
`fmt-money.ts`'s `fmtPct` (4 original sites), `round-floats.ts`, `thermal/lib/gex-heatmap/
shift-math.ts`'s `fmtShiftPercentForStrike`, and this feature's own command-deck siblings
(`PlayTerminal.tsx` / `ZeroDteCommandPanel.tsx`, both named `signPct` but independently pasted,
not a shared helper) — confirming grepping by function NAME misses instances; the bare-`Math.round`
+ raw-sign-ternary SHAPE is what has to be searched for.

### Evidence (RED → GREEN)

New test file `src/features/nighthawk/lib/format-net-vex.test.ts`, driving the real, exported
`formatTickerDossierText` through a minimal `TickerDossier`/`ScoredCandidate`/`PositioningSummary`
fixture (no fields faked beyond what the function actually reads).

Pre-fix (RED), reproduced by stashing the fix and running the new test against the unchanged
source:

```
not ok 1 - Net VEX: equal-magnitude positive/negative ties render the SAME magnitude
  Expected values to be strictly equal:
  'Net VEX: -2' !== 'Net VEX: -3'
```

(`netVexLine(2.5)` → `"Net VEX: +3"`, `netVexLine(-2.5)` → `"Net VEX: -2"` — a 1-unit magnitude
gap on an identical distance from zero. The zero/null test also failed pre-fix for a related
reason: the raw-sign check rendered a stray `"Net VEX: +0"` for an exact-zero input, which the
fix's rounded-value sign check (`roundedVex > 0`, matching every prior sibling fix) also
corrects.)

Post-fix (GREEN): all 3 new tests pass (ties, ordinary non-tie values, zero/null), plus the
pre-existing `format.test.ts` suite (15 tests) still passes unchanged — 18/18.
`npx tsc --noEmit` clean.

### Blast radius

`formatTickerDossierText`'s "Net VEX" line has exactly one call site inside the function itself
(no duplicate copy elsewhere) — checked via repo-wide grep for `net_vex` and for the bare-
`Math.round` + sign-ternary shape; the only other `net_vex`-adjacent formatting is
`scorer.ts`'s `scoreVexAlignment` (a pure numeric comparison, `positioning.net_vex > 0`, never
formats or rounds the value, so it is not affected). The fixed string reaches two real
consumers: `edition-builder.ts` (the overnight Night Hawk edition prompt, line ~1723) and
`play-explainer.ts` (Largo's play-explainer tool, line ~131) — both inherit the corrected
magnitude automatically since they call the same function.

### Fix rationale

Same fix as all six prior siblings: round by magnitude, then reapply sign
(`Math.sign(n) * Math.round(Math.abs(n))`), and read the `+`/`-` prefix off the ROUNDED value
(`roundedVex > 0`) rather than the raw input — matching `fmtShiftPercentForStrike`'s own
documented rationale that a raw-value sign check can also mislabel an exact-zero-after-rounding
case. Kept local to this one call site (not refactored into a shared helper or an import from
`fmt-money.ts`) because the surrounding line already composes several independently-formatted
fragments inline, matching the minimal, in-place diff shape every prior sibling fix in this bug
class used. Output format (bare integer, no decimals, `+`/`-` prefix, omitted entirely when
`pos.net_vex` is null) is otherwise unchanged.
