> **kind:** FINDING

## Thermal `fmtShiftPercentForStrike` rounded ties toward +Infinity — equal-magnitude melt/build shifts could display different magnitudes — FIXED

| | |
|---|---|
| **Area** | Thermal (`src/features/thermal/lib/gex-heatmap/shift-math.ts`) |
| **Status** | FIXED |
| **Severity** | P3 (display-only, intermittent — only on an exact `.5`-at-whole-percent tie) |

### Root cause

`fmtShiftPercentForStrike` (the "+55% / −12%" whole-percent intraday wall-shift badge shown on
the Thermal matrix, the Vector 0DTE matrix rail, and the SPX GEX matrix heatmap — all three import
it) rounded with a bare `Math.abs(Math.round(pct))`:

```ts
const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
return `${sign}${Math.abs(Math.round(pct))}%`;
```

`Math.round` in JavaScript ties toward **+Infinity**, not away from zero:
`Math.round(-2.5) === -2` but `Math.round(2.5) === 3`. Because the sign is applied *after*
rounding the raw (signed) value, a strike melting by exactly −2.5% rounded to magnitude **2**
(`"−2%"`), while the mirror-image strike building by exactly +2.5% rounded to magnitude **3**
(`"+3%"`) — two equal-magnitude, opposite-direction shifts rendered as visibly different sizes.
A secondary instance of the same shape: a shift whose magnitude rounds to exactly 0 (e.g. −0.3%)
printed the misleading `"−0%"` instead of a plain `"0%"`, because the sign was read off the raw
value rather than the rounded one.

This is **not a new bug class in this repo** — it is the exact asymmetry already found and fixed
twice elsewhere: `src/lib/fmt-money.ts`'s `fmtPct` (fixed 2026-10-26, full repro in that file's own
header) and `src/lib/round-floats.ts`'s per-field rounding walk. Both of those fixes left this
sibling Thermal-desk formatter untouched — it lives in a different file
(`src/features/thermal/lib/gex-heatmap/shift-math.ts`) and was never swept when the other two were
patched.

### Evidence (RED → GREEN)

Added two regression tests to `shift-math.test.ts`:
- `fmtShiftPercentForStrike(1_025_000, 25_000)` (pct = +2.5, a real tie) vs
  `fmtShiftPercentForStrike(-1_025_000, -25_000)` (pct = −2.5, the exact mirror). Before the fix:
  `"+3%"` vs `"−2%"` (asymmetric — test failed). After the fix: `"+3%"` vs `"−3%"` (symmetric).
- `fmtShiftPercentForStrike(-1_003_000, -3_000)` (pct = −0.3, rounds to 0). Before the fix:
  `"−0%"`. After the fix: `"0%"`.

Ran RED first (`git stash`-equivalent — tests added against the unfixed function):
```
# tests 16, # pass 14, # fail 2
```
Then applied the fix and reran the same file: `# tests 16, # pass 16, # fail 0`. All 5 pre-existing
tests in the file (including the non-tie whole-percent cases `+50%`/`−50%`/`+55%`/`+113%`) still
pass unchanged.

### Blast radius

`fmtShiftPercentForStrike` is imported by:
- `src/features/thermal/components/GexHeatmap.tsx` (Thermal matrix shift badges)
- `src/features/thermal/components/ThermalCompactMatrix.tsx`
- `src/features/vector/components/VectorOdteMatrixRail.tsx` / `vector-odte-matrix-rows.ts`
- `src/features/spx/components/SpxGexMatrixHeatmap.tsx`
- `src/lib/gex-heatmap-display.ts`

All six consumers get the fix for free — it is one shared formatter, no call sites needed
changes.

### Fix rationale

Mirrors `fmt-money.ts`'s already-established fix exactly: round `Math.abs(pct)` first, then
reapply `Math.sign(pct)`, so both signs tie the same direction (away from zero) instead of JS's
default toward-+Infinity tie-break. Sign is then read off the *rounded* value, not the raw one, so
a magnitude that rounds to exactly 0 reads a plain `"0%"` rather than a signed `"−0%"`/`"+0%"`.
Deliberately did **not** change `shiftPercentForStrike` (the underlying raw-percent calculation,
used elsewhere un-formatted) or `wallStrengthShift` (a separate, already-correct magnitude-based
calculation) — only the whole-percent *formatter* had the bug.
