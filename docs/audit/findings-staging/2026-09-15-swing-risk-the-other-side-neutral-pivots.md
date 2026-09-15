> **kind:** FINDING

## Structure Ladder's "Risk — the other side" could name a neutral pivot (gamma flip/max pain/magnet) as "real structure" over a genuine, farther wall — FIXED

| **Status** | FIXED (this commit) |
|---|---|

**Root cause:** `riskTheOtherSide` (`src/lib/swing/play-brief-ladder.ts`, `buildStructureLadder`)
picked the nearest rung on the unfavorable side of spot by raw `distancePct`, with **no regard to
`role`**. But this same file's own `roleForKind` (two paragraphs above the computation) is
explicit that regime-pivot nodes — gamma flip, max pain, the gamma magnet — are deliberately
labeled `"neutral"` because they "are NOT hard support/resistance ... never as a wall a price
bounces off," unlike genuine dealer walls (call/put wall, GEX king, dark pool), which earn
`"support"`/`"resistance"`. The nearest-by-distance reduce ignored that distinction entirely, so a
neutral pivot could — and, live, routinely did — win over a farther-but-real wall whenever the
pivot happened to sit closer to spot.

**Evidence (live reproduction, 2026-09-15, forensic batch 28, 4 of 5 structureLadder tickers
checked):**
- **AAPL** (LONG): picked `gamma_flip` @319.06 (-4.0%, neutral) over the real `put_wall` @280
  (-15.7%, support) — the put wall was available on the same ladder and ignored.
- **CG** (SHORT): picked `magnet` @43.19 (+3.3%, neutral) over the real `call_wall`/GEX king @52.5
  (+25.5%, resistance).
- **ENPH** (LONG): picked `magnet` @36.67 (-0.03%, essentially at spot, neutral) over the real
  `put_wall` @35 (-4.6%, support) — the magnet sat 1 cent from spot, not a meaningful risk level.
- **PEGA** (LONG): picked `max_pain` @35 (-8.3%, neutral) over the real `put_wall` @30 (-21.4%,
  support) — a 13-point/~13-percentage-point gap between what the widget showed and the real
  downside wall.

The member-facing widget (`BieStructureLadder.tsx`'s `RiskTheOtherSide`) renders whichever rung
wins verbatim as **"the nearest real structure on the wrong side of this thesis"** — calling a pin
statistic or regime boundary "real structure" directly contradicts this codebase's own documented
stance on what those nodes are, and in PEGA's case silently hid the actual downside wall a trader
should be watching by a large margin.

**Blast radius:** any structureLadder ticker where a neutral pivot (gamma flip/max pain/magnet)
sits nearer to spot than the nearest genuine wall on the unfavorable side — measured at 4/5 tickers
in one forensic batch, so common rather than an edge case.

**Fix:** split the unfavorable-side rungs into "real walls" (`role !== "neutral"`) and "everything
unfavorable," and prefer the nearest real wall; only fall back to the nearest neutral pivot when no
real wall exists on the unfavorable side at all (the GLXY-shape case this file's own comment already
anticipated, unchanged by this fix — confirmed via a dedicated regression test).

**Fix rationale:** minimal, targeted change to the selection logic only — the rung-building,
role-assignment, and `target`-gating logic above it are all untouched, and the fallback preserves
the one case where naming a neutral pivot is genuinely correct (nothing else to name).

**Test:** RED→GREEN proven (git-stashed the source fix, confirmed the new "prefers a farther REAL
wall" regression test — built directly off the live PEGA repro shape — fails with the exact
production symptom (picks the neutral pivot) against pre-fix code; restored and confirmed it passes,
alongside a second new test proving the GLXY-shape fallback case is unchanged, and all 3 pre-existing
`riskTheOtherSide` tests still pass unmodified). Full `src/lib/swing/*.test.ts` suite (1145 tests, up
from 1143) green, `tsc --noEmit` and `eslint` clean on both changed files.
