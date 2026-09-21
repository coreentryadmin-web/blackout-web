## Night Hawk Legacy — rank-bucket diagnostic doc comment described bucketing backwards; extended with median/CI/tail-rate/correlation/segmentation + counterfactual tracing — FIXED (doc) + EXTENDED (analysis)

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | `src/features/nighthawk/lib/rank-bucket-analysis.ts` (doc comment), new `rank-bucket-analysis-extended.ts`, `src/app/api/admin/nighthawk/rank-bucket-analysis/route.ts` |
| **Status** | FIXED (doc comment) + EXTENDED (new read-only analysis capability) |
| **Severity** | P3 — a documentation inaccuracy (not a code bug: `computeRankBucketStats` itself already bucketed strictly by the row's own `rank` column, correctly) that would have led anyone reading it to misinterpret what "rejected" rows in each bucket actually represent |
| **Found via** | operator directive to answer, with real evidence, whether Legacy's current rank/score already concentrates forward performance into ranks 1-5 — before any Winner-DNA design work |

### Root cause (doc comment)

`bucketForRank`'s doc comment claimed a "rejected" row that was ranked before being cut (e.g. by
the cross-edition governor or a STAGE-6 gate) buckets by that rank, and that only a confluence-gate
reject falls into `rejected_unranked`. Verified directly against the row-builders in
`edition-builder.ts`: `buildGovernorCutSnapshotRows` (governor cuts) and
`buildStageRejectionSnapshotRows` (all 6 STAGE-6 reasons) both write `rank: null`
**unconditionally** — the opposite of what the comment claimed. Only the STAGE-2 confluence-gate
reject (`candidates.ts`'s `buildDiscoveryStageSnapshotRows`) carries a rank at all, and it's that
ticker's **discovery-stage** rank (its position in the raw composite-score pool, before
dossiers/scoring/chains exist) — not any later pre-cut position, since no later stage ever stamps
one for a rejected row. The comment has been corrected in place; `bucketForRank`'s actual logic
(bucket strictly by `row.rank`, null → `rejected_unranked`) was already correct and is unchanged.

### What shipped: extended analysis, not a production change

New file `src/features/nighthawk/lib/rank-bucket-analysis-extended.ts` (pure, no I/O, kept
separate from the tested base module) adds:
- Median MFE/MAE (the base module only had mean), an MFE:MAE ratio, and a large-winner/large-loser
  tail rate (a disclosed, adjustable threshold — default 10% sign-aligned EOD move — never
  silently assumed).
- Normal-approximation 95% confidence intervals on win rate and mean EOD return, genuinely wide at
  low n rather than hidden.
- A Spearman rank↔outcome correlation (h1/eod/MFE/MAE), computed only over rows carrying both a
  real `rank` and a graded reading, reporting `null` with an explicit reason below a minimum-n
  floor or when either side has zero variance — never fabricated as 0.
- Segmentation by direction (CALL/PUT), conviction tier (A/B/C), a fuller trend-regime read (joins
  the `discovery`-stage row's full `market_regime.trend`, since only the coarse
  `regime_multiplier` scalar survives past discovery), and a heuristic `setup_type` label
  (whichever score component dominates `snapshot_json.components` — explicitly documented as a
  DERIVED, best-effort label, "unknown" whenever no components object is present, which is true
  for most `rank_final` and STAGE-6 rejected rows today).
- A counterfactual "rejected winner / Top-5 loser" tracer: Top-5 losers are a straightforward
  `rank_final` filter; rejected winners compare the row's own `score` (always populated on
  rejected rows, unlike `rank`) against that same edition's real published scores — an honest,
  disclosed proxy for "would this have made the book," never presented as the literal rank the
  candidate would have held.

The admin route (`GET /api/admin/nighthawk/rank-bucket-analysis`) gained an additive `extended`
block on both the `baseline` and `recent` windows, computed from the exact rows already fetched
(zero extra I/O), plus one opt-in extra fetch (`include_discovery_regime=1`) for the trend-regime
join. Every existing field/behavior is unchanged; no current caller's shape breaks.

### Genuine data gaps, disclosed rather than worked around

- **DTE/expiry**: not captured anywhere in `nighthawk_candidate_snapshot` at any stage — confirmed
  by reading every stage's `snapshot_json` shape. No DTE breakdown exists here because there is
  nothing to break down; see the companion Workstream C PR for the capture fix.
- **Real data volume as of 2026-09-21**: per the durable journal, the table holds essentially one
  edition's worth of ungraded rows. This diagnostic will correctly report low-n/insufficient-data
  almost everywhere until several more trading days accumulate and grade — that is the honest
  current answer to "does rank concentrate performance today," not a defect in the tool.

### Evidence

- `git diff` on `rank-bucket-analysis.ts`: doc comment only, zero logic change; its own
  `rank-bucket-analysis.test.ts` (23 tests) passes completely unmodified.
- New `rank-bucket-analysis-extended.test.ts`: 22 tests covering every new stat, every
  segmentation, and both tracer functions (including the exact counterfactual-rank-estimate string
  format and the honest confluence-gate fallback).
- Full `src/features/nighthawk/**` suite: 1817/1817 pass. `tsc --noEmit` clean. `next lint`: no
  warnings.

### What's still open

Once enough real editions accumulate and grade, pull `GET /api/admin/nighthawk/rank-bucket-analysis`
(with `include_discovery_regime=1` for the fuller regime read) and report the actual numbers —
that report is the deliverable the operator asked for. No Winner-DNA design work resumes before
that.
