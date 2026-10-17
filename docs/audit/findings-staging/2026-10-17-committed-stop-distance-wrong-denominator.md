> **kind:** FINDING

## Swing play-brief's "committed structural stop" distance divided by the stop level instead of spot — wrong denominator, two independent occurrences — FIXED

| **Status** | Fixed (`committedStructuralStopLine()`, `src/lib/swing/play-brief-narrative.ts`; the CLOSED "reclaimed the stop level" line, `src/lib/swing/play-brief-intel.ts`) |
|---|---|

**Found via:** this session's standing Ask Largo deep-dive (5-engine monitor cycle, 2026-10-17 ~23:10 UTC).

**Live repro.** `GET /api/market/swing/play-brief?ticker=CRWV&playId=SWING:CRWV:61&positionId=61&expandIntel=1` (production, 2026-10-17 ~19:14 ET), CRWV OPEN/HOLD. Envelope's own `spot` level: 60.99. "Trade manager read" rendered:

> **Structural stop (committed)** — lose **57.06** on a closing basis (**6.9%** away) → an enforced exit regardless of option P&L, independent of the GEX read above.

**Root cause.** `committedStructuralStopLine(play, spot)` computed `Math.abs(((spot - inval) / inval) * 100)` — dividing by `inval` (the stop/target level) instead of `spot` (the current price). Every sibling "% away from a level" figure in the exact same brief (call wall, put wall, max pain, gamma magnet) uses the file's own `distPct(spot, level)` helper, which divides by `spot` — confirmed by cross-checking CRWV's other sibling figures against their shown values (put wall −1.6%, max pain +23.0%, gamma magnet +17.6% — all match `(level-spot)/spot`). With spot=60.99/inval=57.06: the buggy formula gives 6.887%→"6.9%" (exactly what rendered); the correct formula gives 6.444%→"6.4%".

**Why this is a distinct bug from the already-open spot-SOURCING question (PR #4076, comment 6242808561, 2026-10-17 ~22:52 UTC):** that question is about which spot VALUE feeds this calculation (Vector/GEX snapshot vs. the swing-serving-lane's cached spot vs. a live read) — still open, not addressed here. This finding is about the FORMULA applied to whatever spot value arrives — a separate, independent defect. The earlier TSLA repro that surfaced the sourcing question sat at only 0.6% distance, where `/inval` and `/spot` round to the identical displayed value, which is exactly why this formula bug was invisible there and only became visible once a wider gap (CRWV's 6.9% vs 6.4%) crossed a rounding boundary.

**Blast radius — a second, independently-written occurrence of the identical bug.** `src/lib/swing/play-brief-intel.ts`'s CLOSED-bucket "stop fired, did spot reclaim it" coaching line (scoped to `closedReason === "stopped"/"stop"`) computed `pctFromInval` with the same wrong denominator. Confirmed via `grep -rn "/ inval)" src/lib/swing/*.ts` — exactly these two occurrences, not a shared/copy-pasted function.

**No prior test coverage on either function** (`grep -rn "committedStructuralStopLine" src/lib/swing/*.test.ts` returned nothing before this fix).

**Fix.** Both sites now divide by `spot`, matching this file's own established `distPct()` convention and every sibling distance figure in the same brief.

**Tests.** Added one regression test per site, each using a wide gap (6-17 points) so the buggy and correct formulas produce visibly different displayed percentages rather than rounding to the same value. RED→GREEN proven via `git stash` of the 2 source files (2 failures without the fix, 0 with it restored). Broader regression: `src/lib/swing/*.test.ts` — 1825/1825 pass. `tsc --noEmit`: clean.
