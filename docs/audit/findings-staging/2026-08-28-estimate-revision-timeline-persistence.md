> **kind:** `FINDING`

## Estimate-revision timeline is momentary, not cumulative

| **Status** | FIXED |

`diffEstimateRevisionTimeline` (Redis snapshot diff) only emits a revision in the single ~20-min
cached build that happens to run while the delta is fresh — diffing a row also advances the Redis
snapshot it compares against, so the next build compares equal and stays silent forever after.
Measured live 2026-08-18: `estimate_revision_timeline` served **4 entries at 14:52 UTC and 0 at
14:57 UTC**. Nothing was wrong with either number in isolation, but a member who opened the page
outside the one detecting build's window saw an empty panel despite the word "timeline" promising
a series.

**Root cause.** The diff's Redis snapshot (`meridian:est-snap:v1:<ticker>:<date>`, 14-day TTL) is
mutated as a side effect of comparison: on the same pass that detects `prev.estimated_eps !==
row.estimated_eps` and emits a revision entry, it also overwrites `prev` with `row`'s values. Any
later ~20-min rebuild diffs the now-current value against itself and finds nothing — the emission
is single-shot per real-world change, not per read.

**Fix.** New table `meridian_estimate_revisions` (one row per detected revision, `UNIQUE (ticker,
event_date, change_kind, revised_at)`, `ON CONFLICT DO NOTHING` for safety under overlapping
rebuilds) — same "persist what the diff emits" pattern as `meridian_report_snapshots`.
`loadBenzingaEarningsBundle` now writes every freshly-diffed entry (fire-and-forget, mirrors
`recordMeridianReportSnapshot`'s call-site pattern) and merges the live diff with
`readRecentMeridianEstimateRevisions(since, 24)` via a new pure `mergeEstimateRevisionTimeline`
helper — same `(ticker, date, change_kind, last_updated)` key dedupes a revision seen by both the
live diff and persisted history, newest-first, capped at 24 (unchanged cap). A member visiting
between builds now sees the accumulated recent history instead of only whatever this exact build's
diff happened to catch.

**Verification:** `mergeEstimateRevisionTimeline` unit tests reproduce the exact measured
14:52→14:57 scenario (a build with an empty live diff still serves the persisted entries), confirm
a revision seen by both sources counts once, and confirm newest-first ordering + limit across both
sources — 6/6 pass (`npx tsx --test src/lib/meridian/meridian-benzinga-analytics.test.ts`, Node
20). Full Meridian suite (`src/lib/meridian/**/*.test.ts`, `src/features/meridian/**/*.test.ts`,
548 tests) green, 1 unrelated skip. `tsc --noEmit` clean.
