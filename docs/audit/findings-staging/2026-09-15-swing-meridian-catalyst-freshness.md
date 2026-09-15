> **kind:** FINDING

## Swing play-brief Meridian catalyst section had zero freshness disclosure (Largo C2) — FIXED

**Status:** FIXED — `fix/swing-meridian-catalyst-freshness`

### Root cause

`SwingMeridianCatalystSlice.as_of` (`src/lib/swing/play-brief-meridian.ts`) was captured on the
type and stamped at read time (`payload.as_of`, an ISO timestamp), but `meridianCatalystSection`
(`src/lib/swing/play-brief-intel.ts`) never read it — confirmed via a repo-wide grep, the field
was write-only. Every other time-sensitive source composed into the swing play brief (GEX matrix,
Vector snapshot, option mark, discovery scan, 0DTE/Night Hawk cross-desk) has an explicit
staleness gate that prefixes a "Last snapshot (~Xs old)" caveat once its age crosses a bound —
Meridian's catalyst calendar was the one section with none, so present-tense prose ("No catalysts
in the 14-day Meridian window on this read — calendar is quiet, not missing") could describe data
that was actually stale.

This is not a hypothetical staleness window: `fetchMeridianForTicker` reads through
`serverCache`/`withServerCache` (`src/lib/server-cache.ts`) with a 120s TTL
(`MERIDIAN_TIMELINE_TTL_MS`), but that cache's stale-while-revalidate path can keep serving the
same stored payload — and its true, un-bumped `as_of` — for up to `MAX_STALE_AGE_MS` = **10
minutes** when the upstream Benzinga feed is degraded (`src/lib/server-cache.ts:20,189-216`). A
"quiet calendar" claim under that path could be reporting a read up to 10 minutes old with no
indication to the reader.

### Evidence

- Direct source read confirmed `payload.as_of` is stamped once inside `loadMeridianTimelineResponse`
  (`new Date().toISOString()`, `src/lib/meridian/meridian-snapshot.ts:77`) and `withServerCache`
  returns the STORED value (from the last successful loader run) on a stale-while-revalidate hit,
  not a freshly-recomputed one (`src/lib/server-cache.ts:156-216`) — so the age check is measuring
  something real, not a value that regenerates itself every read.
- Repo-wide grep confirmed `slice.as_of`/`ctx.meridian.as_of` had zero readers before this fix.
- Live production sampling (5 real swing play-briefs across OPEN/WATCH, mix of GEX-fresh and
  GEX-stale tickers) confirmed every other section's freshness handling is correct (CRWD's stale
  GEX/Vector correctly suppressed present-tense prose; AAPL/ORCL's fresh reads correctly rendered
  with no caveat) — Meridian catalysts was the one section with zero timestamp in the same envelope.

### Blast radius

Single call site: `meridianCatalystSection` is the only consumer of `SwingMeridianCatalystSlice`
in narrative prose. No other product surface reads this slice.

### Fix

Added `meridianCatalystAgeMs`/`meridianCatalystStale` (`src/lib/swing/play-brief-absence.ts`),
mirroring the existing `gexMatrixAgeMs`/`gexMatrixStale` pattern exactly — same 120s bound
(`GEX_MATRIX_STALE_MS`), same future-skew fail-closed guard. `meridianCatalystSection` now prefixes
a `**Last snapshot** (~Xs old) — catalyst calendar may lag.` caveat (same "Last snapshot" wording
GEX/Vector already use) on every render path when the read is stale, and
`collectBriefUnavailableSources` now surfaces a "Meridian catalysts" / "stale — calendar read may
lag" entry (gated off for CLOSED plays, same as every other live-desk-freshness check in that
function — a closed position's historical record doesn't need today's staleness flagged).

### Fix rationale

Reused the existing GEX/Vector staleness pattern rather than inventing a new one — same threshold,
same "Last snapshot" prose shape, same `collectBriefUnavailableSources` wiring shape. Left the
`unavailable: true` branch (total fetch failure) untouched — that's a distinct, already-correct
signal from a stale-but-present read, and gating `staleLead` on `!slice?.unavailable` implicitly
(the function returns early on that branch) keeps the two honest and separate.

Existing test fixtures across the codebase use a simplified `as_of` shape
(`"2026-09-06 09:00 ET"`, not the real ISO format) — verified this parses to `NaN` via `Date.parse`,
so `meridianCatalystAgeMs` returns `null` and `meridianCatalystStale` returns `false` for all of
them, meaning no existing test needed modification; new tests use a real ISO `as_of` to exercise
the staleness path.

### Tests

- `src/lib/swing/play-brief-absence.test.ts`: `meridianCatalystStale`/`meridianCatalystAgeMs` unit
  tests (fresh, stale, unparseable-as_of, null-slice) + `collectBriefUnavailableSources` stale/
  CLOSED-gating tests.
- `src/lib/swing/play-brief-intel.test.ts`: `meridianCatalystSection` stale-prefix and fresh-no-prefix
  tests.
- RED→GREEN proof: `git stash` on the two source files reproduced 5 failing tests against the
  pre-fix tree; restoring the fix returned the suite to green.
