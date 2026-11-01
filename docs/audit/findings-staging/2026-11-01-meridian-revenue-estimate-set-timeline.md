> **kind:** FINDING

# Meridian estimate-revision timeline: revenue "estimate set" event never emitted (EPS gets one, revenue doesn't)

| | |
|---|---|
| **Area** | Meridian — `meridian-benzinga-analytics.ts`, `diffEstimateRevisionTimeline` |
| **Severity** | P3 (silent feature gap, member-visible "Estimate revisions" panel under-reports real news) |
| **Status** | Fixed |

## Root cause

`diffEstimateRevisionTimeline` diffs each incoming Benzinga row against its persisted Redis
snapshot and emits a `MeridianEstimateRevisionEntry` for each kind of real change it detects:
a print landing (`"print"`), a date-status change (`"date_status"`), an EPS-estimate change
(`"eps"`), and a revenue-estimate change (`"revenue"`).

The EPS branch has two cases — an estimate CHANGING (`prev.estimated_eps != null` and it moved)
and an estimate being SET for the first time (`prev.estimated_eps == null`, no actual yet):

```ts
if (row.estimated_eps != null && prev.estimated_eps != null && row.estimated_eps !== prev.estimated_eps) {
  // "EPS est X → Y"
} else if (row.estimated_eps != null && prev.estimated_eps == null && row.actual_eps == null) {
  // "EPS est set · Y"   <-- only case that existed for EPS
}
```

The revenue branch only had the first case — a revenue estimate CHANGING. There was no `else if`
for a revenue estimate being SET for the first time, even though the exact same situation (a
ticker first tracked without a street revenue estimate, then Benzinga publishes one before any
actual print) is just as real and just as newsworthy as the identical EPS case. The first-sighting
revenue estimate was silently absorbed into the snapshot write at the bottom of the loop
(`if (changed || row.last_updated) { await sharedCacheSet(...) }`) with no entry ever pushed to
`out` — so members saw "EPS est set" revisions but never the revenue-side equivalent, on data that
was equally real and equally present.

## Evidence

- Repo-wide check confirms `diffEstimateRevisionTimeline` had **no existing test coverage at all**
  before this fix (`meridian-benzinga-analytics.test.ts` only tested `mergeEstimateRevisionTimeline`,
  `buildEarningsWeekAnalytics`, `buildStreetSkewFromPriceTargets`, `surpriseDistributionFromRows`).
- New regression test (`diffEstimateRevisionTimeline: emits a revenue 'estimate set' entry on first
  sighting, same as EPS`) seeds a snapshot with both estimates null, then feeds a second row where
  BOTH an EPS and a revenue estimate appear for the first time (no actual yet):
  - **RED (pre-fix)**: EPS "set" entry present, revenue "set" entry absent — test failed on
    `assert.ok(revenueSet, ...)`.
  - **GREEN (post-fix)**: both entries present, `revenueSet.headline === "<ticker> Rev est set · 5000000000"`.
- `src/features/meridian/components/MeridianDesk.tsx` (~line 585) and
  `MeridianEarningsTabs.tsx` (~line 419) render `estimate_revision_timeline` entries purely by
  `r.headline` — the UI already treats `"revenue"` as a first-class `change_kind`
  (`meridian-types.ts`'s union already lists `"eps" | "revenue" | "date_status" | "print" |
  "calendar"`), so the new entry type requires no UI change and renders identically to the
  existing revenue-change entries.

## Blast radius

Only one call site: `meridian-benzinga-earnings.ts` (`diffEstimateRevisionTimeline` called at
line 133 for the live incremental diff, and re-exported at line 280 for an admin/backfill path).
Both consumers get the fix automatically — no other file duplicates this diff logic.

## Fix rationale

Added an `else if` branch to the revenue-estimate block, structurally identical to the pre-existing
EPS branch: fires only when `row.estimated_revenue != null && prev.estimated_revenue == null &&
row.actual_revenue == null` (estimate newly present, no actual yet — mirroring the EPS guard's
"no actual yet" condition so a revenue estimate that arrives bundled with an actual print doesn't
also get a spurious "set" entry alongside the "print" entry). Left the revenue CHANGE branch's
near-zero-delta suppression (lines above) untouched — that's a separate, already-correct piece of
logic about display-precision rounding, not part of this gap. No gate, schema, or UI change
required.
