> **kind:** FINDING

## HELIX/Thermal compare card's gamma summary baked a fully-unrounded flip float into its text — FIXED

| | |
|---|---|
| **Area** | Largo cross-product compare card (`get_helix_thermal_compare` / `HelixThermalCompareCard`) |
| **File** | `src/lib/largo/helix-thermal-compare.ts` |
| **Status** | FIXED (`fix/helix-thermal-compare-unrounded-flip-summary`) |

### Root cause
`gammaSummary`'s fallback branch (used whenever a positioning snapshot has no `gamma_regime_read`
prose but does have a real `flip`) built its string with raw template-literal interpolation:
`` `Flip ${flip}` ``. `flip` is a plain JS number straight off the upstream provider, with no
rounding applied — template-literal interpolation calls `Number.prototype.toString()`, which
prints FULL double precision, not 2dp.

The SAME raw `flip` also feeds the numeric `gamma.flip` field a few lines down, which — because
the whole payload is wrapped in `roundFloats()` at the top of `helixThermalCompareForLargo`/
`peerTickerCompareForLargo` — gets correctly rounded to `Math.round(n*100)/100`. But `summary` is
already a baked STRING by the time `roundFloats()` runs, so the wrapper can't touch a number
already embedded in text. Result: two different-looking values for the same fact in one payload.

This is CLAUDE.md's own named "systemic: several endpoints serve unrounded floats" class, but one
layer deeper than the usual raw-JSON-number case — it's a raw number baked into narrated PROSE,
the same shape as the toFixed-vs-roundFloats bug already fixed three times this week in
`play-brief-narrative.ts` (#5380), `play-brief-narrative-coaching.ts` (#5383), and
`play-brief-ladder.ts` (#5385) — but in the HELIX/Thermal compare card rather than the swing play
brief, and via raw interpolation rather than `.toFixed(2)` (an even less-rounded starting point).

### Evidence
Live repro, run directly against the pure `compareSidesFrom` function:
```
compareSidesFrom({ gamma_regime_read: null, gamma_posture: null, flip: 4523.360000000001, spot: 4520 }, { rows: [], available: false })
  -> gamma.summary === "Flip 4523.360000000001"   (raw, unrounded)
  -> gamma.flip    === 4523.360000000001          (would round to 4523.36 via roundFloats() at the route)
```
Added a RED→GREEN regression test in `helix-thermal-compare.test.ts` pinning `summary === "Flip
4523.36"` for this exact input. Pre-fix: fails (`"Flip 4523.360000000001"`). Post-fix: passes.
Full `largo/*.test.ts` + `fmt-money.test.ts`: 942/942 pass. `tsc --noEmit` clean.

### Blast radius
Single call site — `gammaSummary`'s one fallback branch. `gamma.summary` is read by both card
modes this file exports (`helix_thermal` and `peer_tickers`), so both are fixed by the one change.
No other raw-number template-literal interpolations exist elsewhere in this file (checked via grep
for `${...}` template literals — every other one interpolates a label/bias string, never a number).

### Fix rationale
`fmtPriceLevel` (from `@/lib/fmt-money`, the same helper #5380/#5383/#5385 already established for
"bare price level, no `$`, must match `roundFloats`'s rounding") replaces the raw interpolation.
`gamma.flip` itself was already correct (it's a plain numeric field `roundFloats()` handles) — only
the string needed the fix.
