## 2026-09-17 — [FINDING, FIXED] Two independent re-derivations of `stop_data_unavailable` used AND where the canonical grader uses OR

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P3 — a latent grading-honesty inconsistency with no currently-observable live impact (the sole writer never produces the partial-data shape that would trigger it), but a real divergence between three independent copies of "the same" check |
| **Lane** | Night Hawk Legacy |
| **PR** | fix/nighthawk-stop-data-unavailable-and-vs-or |

### Root cause

`play-outcomes.ts`'s `resolveOutcome` — the canonical Night Hawk outcome grader — computes:

```ts
const hasIntraday = high != null && low != null;
const stop_data_unavailable = stop != null && !hasIntraday;
```

which by De Morgan's law is `stop != null && (high == null || low == null)` — an **OR**:
either field missing is enough to distrust the row's intraday-based verdict, because a
LONG's target-hit check needs `high` and its stop-hit check needs `low` (and vice versa
for a SHORT) — both checks matter for the row's grade, so either missing field taints it.

Two independent re-derivations of this same concept — `analytics.ts`'s
`isStopDataUnavailable` (feeds the member-facing `/record` route's exclusion accounting)
and `track-record-page.ts`'s `nhStopDataUnavailable` (feeds the public track-record page)
— both instead required **BOTH** fields to be null:

```ts
return r.stop != null && r.session_high == null && r.session_low == null;
```

This is not equivalent: a row with, say, `session_high` present but `session_low` null
(or vice versa) would be graded `stop_data_unavailable: true` by the canonical grader
(and its `outcome` could still land on `"target"` via the close-only fallback path in
that branch) but would be treated as fully scoreable by both downstream re-derivations,
letting an unreliable close-only "target" grade count as a real win in the public/member
win-rate.

### Why this is disclosed as low-current-impact, not zero-value

The sole writer of `session_high`/`session_low` (`resolvePendingNighthawkOutcomes`,
same file) sources both fields from one Polygon daily OHLC bar object, which is either
fully present or entirely absent — so the partial-null shape this divergence depends on
does not currently occur. This is fixed defensively rather than left to depend on that
writer never changing, per this codebase's own standing discipline (`OUTCOME-GRADING-SPEC.md`)
that two independent copies of "the same" check must never be allowed to drift, checked or not.

### Fix

Changed both `analytics.ts`'s `isStopDataUnavailable` and `track-record-page.ts`'s
`nhStopDataUnavailable` from AND to OR, matching `resolveOutcome`'s actual semantics
exactly. No behavioral change for any row with a fully-present or fully-absent bar
(the only shape ever currently written) — only the previously-unreachable partial case
now excludes correctly.

### Blast radius

Two functions, both private/internal to their files. `analytics.ts`'s
`isStopDataUnavailable` feeds `buildRecordSegment` (the admin/member `/record` route).
`track-record-page.ts`'s `nhStopDataUnavailable` feeds `isNighthawkOutcomeScoreable` →
`nhFromRows` (the public `/track-record` page). No other consumers of either private
function exist.

### Tests

Added a regression test in each file's existing test suite: a 3-row fixture with one
row missing only `session_high`, one missing only `session_low`, and one fully graded —
asserting only the fully-graded row is scoreable/counted. RED confirmed via `git stash`
isolating just each source fix (both failed pre-fix); GREEN confirmed after restoring
(9/9 and 11/11 passing respectively). `tsc --noEmit` clean.
