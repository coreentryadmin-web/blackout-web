# A live committed Swing position's "score pillars" drift away from its own score over time

> **kind:** FINDING

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 (product-honesty/trust — same class as #4826's Banger/Vector-bump fixes, a third distinct occurrence, found on a real open position with real member capital) |
| **Area** | Night Hawk Swings — `src/lib/swing/live-plays.ts` (`livePlayFromSwingPosition`), `src/lib/swing/serving-lane.ts` (`attachThesisExplanation`); consumed by `PlayTerminal.tsx`'s "Why this play was picked" panel and Ask Largo's `play-brief-intel.ts::whyThisSetupSection` ("**Score pillars:**") |
| **Found by** | Standing 5-engine live monitor + Ask Largo × Night Hawk Swings ownership mandate — 2026-09-12 deep-dive cycle |

## Root cause

`GET /api/market/nighthawk/horizons?view=swings` serves a live committed Swing position's
`score` as `row.feature_vector.evidence_score` — deliberately PINNED at commit
(`commit.ts`: "Pin the static thesis feature vector at commit so trajectory studies can
echo pillars/score on every later snapshot"). That pin is correct and intentional; the
bug is what happened to `factors` (the `{label, points}[]` breakdown both the command
deck and Ask Largo render as an itemized explanation of that score).

`serving-lane.ts`'s `attachThesisExplanation` — added 2026-08-12 to fix an earlier defect
where committed positions carried no factors at all ("Component breakdown not served for
this lane yet") — borrowed `factors` from a **same-ticker dossier re-run TODAY**
(`swingServingMetaFromDossier(dossier, reads)`), not from the position's own frozen
record. A dossier's pillar reads (structure/rel-strength/regime/volatility/catalyst/flow)
legitimately change day to day as the market moves. So the longer a position stays open,
the more its freshly-borrowed `factors` diverge from the `score` that was pinned the day
it was committed — two independently-computed numbers that were never guaranteed to
agree, silently drifting apart with no error anywhere in the pipeline.

This is the same underlying failure MODE as the two fixes in #4826 ("score bumped,
factors never touched" for Vector corroboration; "factors measure a different quantity
than score" for Banger positions) — but a third, distinct occurrence: here neither side
is individually wrong, they are just two independent computations of what the desk
presents as one connected explanation.

## Evidence

Live `GET /api/market/nighthawk/horizons?view=swings` (2026-09-12, ~05:13 UTC):

- `AAPL`, positionId 37, archetype `SECTOR_ROTATION`, committed 2026-09-11T19:06:15Z
  (real open capital, `entryPremium: 6.73`, `livePnlPct: -8.2`):
  `score: 84.4` next to `factors` = `[Rel. strength 29.5, Structure 21.1, Regime 14,
  Volatility 6.3, Catalyst 2.8, Flow 1.3]` — **sum 75.0, a 9.4pt (11%) unexplained gap**.
  (`DATA_QUALITY` pillar absent from both the shown factors and the underlying dossier
  read — consistent with only 6/7 pillars grounded, which is honest; the gap is not
  explained by a missing 7th pillar, since an absent pillar contributes 0 either way.)
- Cross-checked every committed SWING row in the same snapshot (90 total): of the ~7 rows
  that are genuine swing-pillar dossiers (not Banger-origin, which #4826 handles
  separately, and not pre-entry WATCH, which never pins a score), 3 showed a real
  mismatch beyond rounding noise — AAPL (+9.4), MRVL (+6.3), IREN (−14.8) — confirming
  this is a real, reproducible pattern on live positions, not a one-off.

## Blast radius

- `live-plays.ts`'s `livePlayFromSwingPosition` — the source of the frozen `score`; it
  never set `factors` at all before this fix (returned play had no `factors` field).
- `serving-lane.ts`'s `attachThesisExplanation` — the borrow site; every live
  MANAGING/SCALING_OUT/EXITING committed row it enriches was affected once the position
  aged past commit day.
- `serving-ingest.ts`'s `swingServingMetaFromDossier` and `PILLAR_LABELS` — duplicated the
  label map and filter/sum logic that now lives once in `swing-pillars.ts`
  (`SWING_PILLAR_LABELS` / `contributionsToFactors`), so the pre-entry and live-pinned
  factor-building code paths can no longer drift apart from each other either.
- Not touched: `banger-lane-merge.ts` / `vector-lane-enrich.ts` (already fixed by #4826,
  a different pair of code paths); the 0DTE lane's `factor_breakdown` mapping (separate
  scoring system).

## Fix

- Added `SWING_PILLAR_LABELS` and `contributionsToFactors(contributions)` to
  `swing-pillars.ts` — the single shared place that turns a `scoreSwingPillars(...)`
  call's `contributions` into displayable `{label, points}` rows. By construction, the
  returned points always sum to that SAME call's `.score` (present-but-zero/absent
  pillars contribute 0 to both the sum and the display either way, so filtering them out
  can never create a gap) — the invariant only breaks when a caller pairs one call's
  factors with a DIFFERENT call's (or a frozen) score, which is exactly what this fix
  stops happening.
- `serving-ingest.ts` now calls the shared helper instead of a private duplicate (pure
  refactor, no behavior change — same filter/sort/round logic, now written once).
- `live-plays.ts`: new `pinnedFactorsFromFeatureVector(featureVector)` reconstructs
  `factors` from the position's own **frozen** `pil_structure`/`pil_rel_strength`/etc +
  `archetype` (pinned in `feature_vector` at commit, alongside `evidence_score`) by
  re-running `scoreSwingPillars` on those SAME frozen inputs. Because that function is
  pure and deterministic, the result reproduces the identical score and contributions
  that sum to it — the sum-to-score invariant holds because it's the same computation
  on the same frozen data, not because two independent numbers happen to agree.
  `livePlayFromSwingPosition` now sets `factors` from this reconstruction. Rows that
  predate this feature-vector shape (no `pil_*`/archetype pinned) get `[]`, never a
  fabricated row.
- `serving-lane.ts`'s `attachThesisExplanation` now PREFERS the play's own pinned
  factors (non-empty ⇒ keep them) and only falls back to borrowing the fresh dossier's
  factors for older rows that don't have a pinned breakdown yet — preserving the
  2026-08-12 fix's original behavior for those legacy rows while closing the drift for
  every row committed with a feature vector. `regime`/`sectorLeadershipFacts` are
  unaffected (not score-summing fields) and still benefit from the live dossier read.

### Why this fix and not an alternative

The alternative — make `score` live-recompute instead of staying pinned — was rejected:
the pin is deliberate and load-bearing (`commit.ts`'s own comment: trajectory/calibration
studies read `evidence_score` as the AT-COMMIT prediction to grade against; the
`swing-score-calibration.mjs` audit tool literally buckets closed chains by this pinned
score to check calibration). Un-pinning it to "fix" the display would break that. Instead
the display side (`factors`) was made to match the number it sits next to, using data
that was ALREADY pinned for exactly this purpose.

## Evidence (RED → GREEN)

- RED before fix (git-stashed the four source files, kept only the new/extended tests):
  `npx tsx --experimental-test-module-mocks --test src/lib/swing/live-plays.test.ts src/lib/swing/serving-lane.test.ts src/lib/swing/serving-ingest.test.ts src/lib/swing/swing-pillars.test.ts`
  → 4 of 51 tests fail (the two new live-position sum-to-score reproductions, the new
  `attachThesisExplanation` pinned-factors-win test, and the shared `contributionsToFactors`
  helper test — the last fails to even resolve since the export doesn't exist pre-fix).
- GREEN after fix: same command, 51/51 pass.
- Full suite: `npm test` (Node 20) — 13818 pass / 0 fail / 3 skipped (pre-existing,
  unrelated).
- `npx tsc --noEmit`: clean.

## Market-open validation

Logged in `docs/audit/MARKET-OPEN-VALIDATION.md` — once this is deployed and a genuine
swing-pillar-scored position (not Banger-origin) has been open across at least one full
session, open its "Why this play was picked" panel (command deck) and its Ask Largo
play-brief "Why this setup" section, and confirm the factor rows sum to exactly the score
shown — including on a position that has been held for several sessions, where the drift
this fix closes would previously have been largest.
