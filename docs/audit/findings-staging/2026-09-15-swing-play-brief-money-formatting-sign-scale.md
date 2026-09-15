> **kind:** FINDING

## Ask Largo swing play-brief money formatting: signed distances printed "$-X" instead of "-$X", and dark-pool premiums rendered as raw per-contract prices instead of compact magnitudes — FIXED

| **Status** | FIXED (this commit) |
|---|---|

**Root cause 1 (sign placement):** `fmtDist` (`src/lib/swing/play-brief-intel.ts`) computed a
signed dollar delta (`level - spot`) and passed it straight into `fmtUsd` (aliased `fmtOptionUsd`
from `@/lib/fmt-money`). `fmtOptionUsd`'s own doc comment says it is explicitly "never signed (a
stop/entry/mark/target price is a price, not a delta; callers that need a signed value format it
separately)" — for a negative input, `n.toFixed(2)` already prepends the minus sign, so wrapping it
in `` `$${...}` `` put the `$` glyph in front of the minus, producing `"$-19.48"` instead of
`"-$19.48"`. This codebase already identified and fixed the identical trap once, in `fmtPremium`'s
own doc comment: "Sign OUTSIDE the currency glyph so negatives read '-$1.2M', never '$-1.2M'" —
`fmtDist` never got that treatment.

**Root cause 2 (wrong scale):** the "Dark pool levels" line in `chartLevelsSection`
(`play-brief-intel.ts`) formatted `VectorDarkPoolLevel.premium` — a summed institutional
block-print notional, routinely hundreds of thousands to tens of millions of dollars — through the
same `fmtUsd`/`fmtOptionUsd`, a 2-decimal-cents PER-CONTRACT price formatter. The sibling narration
for the identical field, `narrateDarkPool` (`play-brief-narrative.ts`), already formats it
correctly via `fmtPremium` (compact magnitude, e.g. `$5.2M`) — this call site is the one place in
the swing brief that never got the same treatment.

**Evidence (live reproduction, 2026-09-15, forensic batch 29, `?expandIntel=1`, 12 real tickers):**
Every "Put wall (GEX)" / "Gamma flip" / confluence-node distance line below spot showed the
`"$-N.NN"` pattern — reproduced on TSM (`$-19.48`), ORCL (`$-4.37`), GOOG (`$-13.91` on the wall
line and again on its own confluence node), AAPL (`$-52.21`, `$-13.15`), and CRWD/NN/CG/RBLU/
GMEU/DNA/SOFX/STLN. The dark-pool defect is unconditional but not live-confirmed the same session
(none of the 12 tickers checked currently carry a populated `darkPoolLevels` array on their Vector
snapshot) — it will fire the next time any swing ticker has dark-pool prints.

**Blast radius:** `fmtDist`'s two call sites — `chartLevelsSection`'s Call wall / Put wall / Gamma
flip lines and `formatConfluenceZone`'s confluence-node distance — both fixed by the one shared
helper. The dark-pool premium fix is scoped to its single call site in `chartLevelsSection`.

**Fix:** `fmtDist` now signs the delta itself (`-`/`` outside the glyph) and calls `fmtUsd` on
`Math.abs(delta)`, matching `fmtPremium`'s own documented convention. The dark-pool line now calls
`fmtPremium(l.premium)` instead of `fmtUsd(l.premium)` — already imported in this file and used
elsewhere for HELIX tape premiums.

**Fix rationale:** minimal, one-file change — both defects share a root cause (wrong money
formatter chosen for a signed or large-magnitude value) and both fixes are a one-line swap at their
call site; no change to the underlying numbers, GEX/Vector data, or any other section.

**Test:** RED→GREEN proven — two new regression tests in `play-brief-intel.test.ts` (a below-spot
put-wall distance asserting the body matches `-\$19\.48 from spot` and never contains the substring
`$-`; a dark-pool premium asserting `$5.2M` renders and the raw `$5230000` string never does), both
confirmed failing against the live-repro'd pre-fix strings before the fix, passing after. Full
`play-brief-intel.test.ts` (127 tests) and `src/lib/swing/*.test.ts` (1144 tests) green, `tsc
--noEmit` clean.
