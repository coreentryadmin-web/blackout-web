> **kind:** FINDING

## Night Hawk Legacy — direction-failure cause breakdown reported a non-discriminating cause as the top explanation, with no baseline to catch it — FIXED

| | |
|---|---|
| **Lane** | Night Hawk Legacy (standing mandate) |
| **Surface** | `GET /api/admin/nighthawk/direction-failure-diagnosis` (admin diagnostic read, shipped 2026-09-23) |
| **Status** | FIXED — PR `fix/direction-failure-diagnosis-winner-baseline` |

### Root cause

`diagnoseDirectionFailures` (`src/features/nighthawk/lib/direction-failure-diagnosis.ts`)
builds `cause_breakdown`: a sorted tally of which structural causes fire among
`wrong_direction`-tagged plays, each carrying `pct_of_wrong_direction`. It reports this
number in isolation — nothing in the structure tells a reader whether a cause is actually
**discriminating** (more common among losers than winners) or just a near-universal
background condition that says nothing about why THIS play specifically went wrong.

`winner_cohort` (`CohortMeans`) carries comparison rates for only 4 of the 8
`DirectionFailureCause` values (`regime_conflict`, `catalyst_or_fundamental_conflict`,
`gate_promoted_marginal`, `overreaching_target`) — the other 4
(`flow_dominant_weak_structure`, `structure_vs_flow_disagreement`, `thin_confluence`,
`unclassified`) have no comparison rate anywhere in the report. Even for the 4 that are
covered, a reader of `cause_breakdown` (the field actually meant to answer "what causes
wrong-direction plays") would have to separately open `winner_cohort` and manually
cross-reference each cause name against its corresponding `*_rate_pct` field to notice the
gap — nothing surfaces it inline.

### Evidence

Live-verified against production (`GET /api/admin/nighthawk/direction-failure-diagnosis?days=90`,
one temp admin Clerk session, released), 2026-10-26, well above the `low_n=10` floor:

| cause | wrong_direction n=83 | comparison winners n=21 |
|---|---|---|
| `catalyst_or_fundamental_conflict` | 98.8% | 95.2% |
| `overreaching_target` | 15.7% | 4.8% |
| `regime_conflict` | 3.6% | 9.5% |
| `gate_promoted_marginal` | 1.2% | 4.8% |

`catalyst_or_fundamental_conflict` is the #1-ranked cause by `n` (82 of 83 wrong-direction
rows) — read alone, it looks like the dominant explanation for failures. It is equally
common among winners (95.2%), so it explains nothing about why a specific play failed
versus won. Worse, `regime_conflict` and `gate_promoted_marginal` are *more* common among
winners than losers — the opposite of what their names as "failure causes" suggest. Only
`overreaching_target` shows a real, directionally-consistent gap (3.3x) at this sample size.

### Fix

Added `pct_of_comparison_winners` to each `DirectionFailureCauseCount` entry (null only when
the winner cohort is empty), computed from the winners' own already-classified `.causes`
(every row — winner or not — already runs through `diagnoseDirectionRow`, so no new
classification logic was needed; just a second tally over the same rows). Pure, read-only,
diagnosis-only module — zero effect on live scoring/ranking/direction (confirmed: this
module's own header comment already states it changes nothing live, and its single
consumer is the admin-only diagnostic route).

### Evidence the fix works

RED→GREEN via `git stash` on the lib-only change: 19/22 pass (3 failing assertions on the
new field) without the fix, 22/22 with it. `npx tsc --noEmit` clean.

### Blast radius

Single consumer: `src/app/api/admin/nighthawk/direction-failure-diagnosis/route.ts`. No
other call sites for `diagnoseDirectionFailures`/`DirectionFailureCauseCount`.

### Note on the standing mandate's own journal

The 2026-10-24 `nighthawk-legacy-live-journal.json` entry
(`legacyCandidateCoveragePhase2BUnblockCheck_2026_10_24T1310Z`) recommended "item 7
(wrong_direction root-cause taxonomy)" as the next concrete step for a future session with
"real runway" — but that taxonomy already shipped 2026-09-23
(`direction-failure-diagnosis.ts` + its admin route). The recommendation itself was stale,
the exact staleness trap this repo's CLAUDE.md repeatedly warns about. Verifying the
already-shipped tool live (rather than re-building it) surfaced this real finding instead.
