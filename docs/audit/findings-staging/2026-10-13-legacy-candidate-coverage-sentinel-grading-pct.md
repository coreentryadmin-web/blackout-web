> **kind:** FINDING

## Night Hawk Legacy — candidate-coverage report misreads sentinel shadow rows as a stuck grading job — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P3 (diagnostic-report clarity, not a functional defect) |
| **Surface** | `src/lib/db.ts` (`fetchNighthawkCandidateSnapshotCoverage`), `src/features/nighthawk/lib/candidate-coverage.ts` |

### What was observed

`GET /api/admin/nighthawk/candidate-coverage` (Phase 3 of the continuous-learning mandate, built
2026-09-23) showed two stages flat at `grading_pct: 0` across 14-17 editions / ~16 calendar days
(`bearish_posture_shadow`, `breakout_confluence_shadow`), while every other stage over the
identical window graded 94-100%. That shape — consistent 0% over weeks, not "still
accumulating" — reads exactly like a stuck/broken grading pass, and was investigated as one.

### Root cause (not a bug in the grading pipeline)

Both stages write exactly ONE row per edition build with `ticker: "__EDITION__"` — a sentinel
value, deliberately chosen (per each module's own doc comment) to "never collide with a real
ticker," because these are single BUILD-LEVEL diagnostic comparisons (what would the
bearish-posture / breakout-confluence gate have decided), not per-ticker candidates with a real
price path.

`candidate-forward-grade.ts`'s stage-agnostic grading pass (`gradeNighthawkCandidateForwardReturns`)
groups ungraded rows by `(edition_for, ticker)` and fetches that TICKER's minute bars to compute
`forward_returns`. A `__EDITION__` row can never have real market bars — there is no such
ticker — so it is permanently `skipped` (never force-graded with a fabricated entry, correctly).
This is working exactly as designed: these two stages were never meant to carry an outcome, only
to log a counterfactual decision. The coverage *report*, however, had no way to distinguish
"structurally ungradeable sentinel row" from "real row that hasn't graded yet," so it displayed a
genuinely alarming 0% for a non-issue.

### Fix

`fetchNighthawkCandidateSnapshotCoverage`'s aggregate now also counts
`COUNT(*) FILTER (WHERE ticker = '__EDITION__') AS n_sentinel` per `(stage, rejection_reason)`
bucket. `buildCandidateCoverageReport` computes each bucket's `grading_pct` over the GRADABLE
subset (`n - n_sentinel`) instead of the raw row count — a bucket that is ALL sentinel rows now
reports `grading_pct: null` (no gradable denominator) instead of a misleading `0`, and exposes
`n_sentinel` so a reader can see why. The overall `overall_grading_pct` rollup excludes sentinel
rows from its denominator too (`total_sentinel_rows` now reported separately), so a handful of
structurally-ungradeable diagnostic rows can no longer drag down the headline number for the real
population.

### Evidence

Live `GET /api/admin/nighthawk/candidate-coverage?days=90` pull (2026-10-13, 17 editions,
2026-09-21..2026-10-13): `bearish_posture_shadow` n=17/n_graded=0 (16 editions), 
`breakout_confluence_shadow` n=14/n_graded=0 (14 editions) — both 0% across the FULL observed
window, versus `discovery` 97.7%, `rank_governor`/`scored` 94.8%, `rank_final` 100% over the
identical window. Confirmed via source read: both stages' builder functions
(`buildBearishPostureShadowSnapshotRow`, `candidates-breakout-shadow.ts`'s equivalent) hard-code
`ticker: "__EDITION__"`.

### Blast radius

Two call sites read `NighthawkCandidateCoverageRow`/the coverage report: the admin route (passes
the report straight through, no change needed) and this module's own test suite. No other reader
of `nighthawk_candidate_snapshot` is affected — the grading pipeline itself (`candidate-forward-
grade.ts`) is unchanged; this is a reporting-only fix.

### Not changed

The shadow-tracking modules themselves (`bearish-posture-shadow.ts`, `candidates-breakout-
shadow.ts`) are untouched — their sentinel-ticker design is correct for what they're doing
(one build-level verdict comparison per edition, not a per-ticker outcome to track). Nothing about
the grading pipeline's actual behavior changed; this fixes only how the coverage report presents
rows it can prove are structurally ungradeable.
