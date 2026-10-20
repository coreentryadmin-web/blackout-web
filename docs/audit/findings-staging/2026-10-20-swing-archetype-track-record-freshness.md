## A swing play-brief's archetype/sub-lane track-record evidence mislabeled an on-schedule read as "STALE" roughly a third of every refresh cycle, and the member-visible section disclosed no age at all — FIXED

> **kind:** `FINDING`

| **Status** | Fixed |
|---|---|

**Found:** 2026-10-20, Ask Largo standing mandate — a fresh-angle Workflow audit cross-checking the
swing play-brief against `docs/audit/LARGO-PRODUCT-CONTRACT.md`'s ten points, adversarially
verified (4-agent pipeline: 2 independent investigation angles, each finding independently
re-traced against current source by a dedicated skeptic agent; confirmed real).

**Root cause:** `evidenceFromContext` (`src/lib/swing/play-brief.ts`) computed the "Archetype track
record" evidence fact's `freshness` via the generic cross-product `freshnessFromObservedMs` bucket
(`<60s live, <10min recent, else stale`). `ctx.archetypeTrackRecord` is written only by the
`swing-active-refresh` cron, which runs every 15 minutes during market hours — so any brief
requested 10-15 minutes after the last tick (a normal ~1/3 of every cycle, not a missed tick) got
tagged `freshness: "stale"`, rendered verbatim as `(Swing ledger · STALE · <timestamp>)` in the
evidence[] array Largo reads.

This is the EXACT defect class this same file already found and fixed for the sibling `markAsOf`
field (`optionMarkIsStale`, live repro 2026-09-23 NVDA) — written by the identical 15-minute cron —
but the fix was never swept to the archetype-track-record evidence line, added 2026-09-20 and never
revisited. It is actually worse than the mark case: `calibration-cache.ts`'s own TTL rationale
(`SWING_ARCHETYPE_TRACK_RECORD_TTL_SEC = 120h`) explicitly argues this data's correct staleness
horizon is hours-to-days ("a many-hours-stale graduation verdict is still an honest, useful
citation") — the generic 10-minute bucket was not just reused incorrectly, but reused
backwards-tight versus the module's own documented intent.

Separately: the only member-visible rendering of this data, `archetypeTrackRecordSection`
(`play-brief-intel.ts`), received the full `snapshot` (which carries `asOf`, documented on the type
as "Largo C1/C2 provenance") but never read it anywhere in the function — zero age/staleness
framing in the rendered prose, unlike every sibling section in the same file (Vector, GEX, Meridian,
dark-pool, option mark all render an explicit "last synced"/staleness line). A member could see a
"stale" tag in the hidden evidence array and no staleness disclosure at all in the visible section
for the identical fact — the "two mechanisms disagree about the same field" failure class this
codebase's own comments elsewhere warn about.

**Live impact:** reachable on every swing play-brief citing a graduated archetype/sub-lane bucket —
not an edge case, a normal ~1/3-of-cycle false positive under fully healthy operation.

**Fix:**
- Added `archetypeTrackRecordIsStale(asOfIso, readMs)` (`play-brief-absence.ts`, alongside
  `optionMarkIsStale`) — a cadence-aware check using this data's OWN documented staleness horizon
  (`calibration-cache.ts`'s `SWING_ARCHETYPE_TRACK_RECORD_TTL_SEC`), fail-closed on future skew
  (Largo C2), same discipline as its sibling.
- `evidenceFromContext`'s archetype-track-record fact now only downgrades a generic "stale" verdict
  to "recent" when `archetypeTrackRecordIsStale` disagrees — never touches "live"/"recent", same
  pattern as the existing `markAsOf` fix.
- `archetypeTrackRecordSection` now takes a `readMs` parameter and renders an honest "Track record
  data as of **HH:MM ET**" / "Track record data **stale** — last synced **HH:MM ET**" line, mirroring
  the option-mark section's own phrasing exactly.

**Fix rationale:** Reused the data's own documented TTL rather than inventing a second, looser (or
tighter) constant — keeps "how stale is too stale to cite" answered in exactly one place
(`calibration-cache.ts`). Did not touch the generic `freshnessFromObservedMs` bucket itself — it is
correct for the feeds it was built for; the bug was reusing it unconditionally for a slower-moving
fact with its own documented cadence, exactly as the prior `markAsOf` fix diagnosed for its sibling.

**Blast radius:** both the hidden `evidence[]` entry and the member-visible "Track record" section
fixed in this one PR — the same root cause (a documented staleness horizon that existed but was
never consulted) reaches both surfaces.

**Tests:** 5 new regression tests for `archetypeTrackRecordIsStale` (on-schedule not stale;
many-hours-old but within TTL not stale; past TTL stale; future-skew fail-closed; absent/malformed
`asOf` never throws) — RED→GREEN proven via `git stash` (5/5 fail pre-fix, pass post-fix). 2 new
tests for `archetypeTrackRecordSection`'s new disclosure line (on-schedule "as of", genuine
staleness "stale — last synced") — RED→GREEN proven (2/2 fail pre-fix). 1 new assertion block in
`composeSwingPlayBrief`'s existing evidence[] test (on-schedule read not stale; genuinely-past-TTL
read still stale) — RED→GREEN proven (1/1 fails pre-fix). Full suite green on Node 20, `tsc
--noEmit` clean.
