> **kind:** FINDING

## Night Hawk candidate forward-return % / R-multiple round-half-up ties biased toward +Infinity — FIXED

| **Status** | FIXED |
|---|---|
| **Severity** | P3 (data-correctness, small magnitude, same bug class as ~25 prior sibling fixes this session) |
| **Files** | `src/features/nighthawk/lib/candidate-forward-grade.ts` (`round2`, used by `rawForwardReturnPct`), `src/features/nighthawk/lib/candidate-r-multiple.ts` (`round2`, used by `rMultiple`/`riskPerShare`) |

### Root cause

Both modules defined a local `round2` helper as the naive `Math.round(n * 100) / 100`. JavaScript's
`Math.round` rounds half-way values toward `+Infinity`, not away from zero — `Math.round(-12.5)
=== -12` but `Math.round(12.5) === 13`. Both of these specific `round2` call sites round
**direction-signed** quantities:

- `candidate-forward-grade.ts`'s `rawForwardReturnPct` — the module's own header for `horizons`/
  `session_high_pct`/`session_low_pct` says these are the raw %-move "positive means the underlying
  rose" — i.e. explicitly signed, not unsigned (a stale doc comment on the function itself even said
  "Raw (unsigned) % move", which this fix also corrects).
- `candidate-r-multiple.ts`'s `rMultiple` — the module's own header: "Direction-signed R: positive =
  favorable, negative = adverse." `horizons_r`, `mfe_r`, `mae_r` all go through this.

So an ADVERSE move/R-multiple landing exactly on a 2-decimal tie rounds to a **smaller magnitude**
than the mirror-image FAVORABLE move of identical size — e.g. a −3.125% move (two real price levels:
entry 1.28 → exit 1.24) rendered −3.12 while the symmetric +3.125% move (exit 1.32) rendered +3.13.
The same asymmetry applies to `mae_r`/`mfe_r`: an adverse R of exactly −0.125 rendered −0.12 while
the identical-magnitude favorable +0.125 rendered +0.13 — a losing excursion silently reads as
smaller than an equal-magnitude winning one, same failure shape as the ~25 sibling fixes already
landed this session (`fmt-money.ts`'s `fmtPct`, `rank-bucket-analysis.ts`/`-extended.ts`, etc.) —
this is simply two more call sites of the identical bug class, not found before now.

### Evidence (RED→GREEN)

Added two tests exercising floating-point-bit-exact ties (verified with a brute-force search for
pairs where `Math.round(n*100)/100` and `Math.sign(n)*Math.round(Math.abs(n)*100)/100` actually
disagree, since most "round" decimal price pairs don't land on an exact IEEE-754 tie):

- `candidate-forward-grade.test.ts`: `rawForwardReturnPct(1.28, 1.24)` (adverse) vs
  `rawForwardReturnPct(1.28, 1.32)` (favorable) — before the fix: −3.12 vs 3.13 (asymmetric);
  after: −3.13 vs 3.13 (symmetric).
- `candidate-r-multiple.test.ts`: `computeCandidateRMultiples` with `session_high_pct: 1`/
  `session_low_pct: -1` against an 8-point risk (`mfe_r`/`mae_r` = ±0.125 exactly) — before: mfe_r
  0.13 vs mae_r −0.12 (asymmetric); after: 0.13 vs −0.13 (symmetric).

Confirmed via `git stash` isolating the source fix: both new tests failed RED (2/37) with the
unfixed source, passed GREEN (37/37) with the fix restored. `npx tsc --noEmit` clean.

### Fix

Replaced both `round2` helpers with the same `Math.sign(n) * Math.round(Math.abs(n) * 100) / 100`
pattern already established by `fmt-money.ts`'s `fmtPct` fix and ~25 other sibling call sites this
session. `candidate-r-multiple.ts`'s other `round2` call site (`riskPerShare`, always positive per
its own `rawRisk > 0` guard) is unaffected by the change (sign-safe rounding is a no-op on positive
inputs). Also corrected `rawForwardReturnPct`'s stale doc comment ("Raw (unsigned)" → "Raw
(direction-signed, NOT unsigned)") since the mislabeling likely contributed to the bug surviving —
a reader trusting "unsigned" would have no reason to suspect a sign-tie bias.

### Blast radius

Both functions are pure, internal to `src/features/nighthawk/lib/` — `rawForwardReturnPct`/
`computeCandidateForwardReturns` are consumed only by `candidate-r-multiple.ts` and `db.ts`
(storage), and `computeCandidateRMultiples` only by `edition-builder.ts`. No other call sites
found (`grep -rl` across `src/`).
