## Night Hawk Legacy — an already-PUBLISHED edition's BACKFILL contract could stay dead forever; `republishBackfilledEdition` only ever appended plays, never re-validated an existing one

> **kind:** `FINDING`

| **Status** | FIXED |
|------------|-------|

**Symptom:** standing Ask Largo × Night Hawk Swings ownership mandate (extends to the whole Night
Hawk product — 0DTE, Swings, Legacy). `GET /api/market/nighthawk/edition` on 2026-10-24, roughly an
hour after PR #6631 (the same-day expiry-floor fix for `pickAffordableChainContract`) merged to
`main`, still returned `edition_for: "2026-10-26"` carrying the *exact* BACKFILL PLTR play #6631's
own finding cites — **"PLTR $197.5 Call 2026-10-23"**, 3 calendar days before the edition's own
target trading day, already expired at read time. #6631's fix is real and correct, but it only runs
at edition-*generation* time; this specific edition had already been published (`published_at`
2026-10-23T21:40Z) *before* that fix deployed, so the dead contract was already frozen into its
`plays` JSON and nothing re-validates it after the fact. The admin repair endpoint that exists for
exactly this kind of after-the-fact fix, `POST /api/admin/nighthawk/republish-backfill` →
`republishBackfilledEdition`, no-ops: its own doc comment states it "never touches an already-
published QUALIFIED play; only ever appends real, chain-grounded BACKFILL plays," and this edition
already had 3 plays (at `effectiveMinPublishPlays()`), so calling it would return
`noop_already_at_minimum` without inspecting the existing PLTR play at all. Nothing else in the
pipeline catches this either — `morning-confirm-verdict.ts`'s 9:15am ET cron checks entry-trigger
*geometry* (has price crossed the flagged level), never contract *liveness*, so a BACKFILL play
whose own options contract is already dead sails through to market open looking identical to a live
pick.

**Root cause:** `republishBackfilledEdition` (`src/features/nighthawk/lib/post-publish-backfill.ts`)
reads `existing.plays` from the DB, treats every play in it as correct-by-construction, and only
ever has two things it can do with that list: sync missing `nighthawk_play_outcomes` rows
(`syncOutcomeRows`, an existing repair pass), and — only when `finalPlays.length < minPlays` —
append *new* BACKFILL plays from the frozen `rank_governor` candidate pool. There was no code path
that re-examined an *existing* BACKFILL play's own contract for staleness, so a play that was wrong
at publish time (whether from the #6631 bug before it was fixed, or any other cause) stayed wrong
for the rest of that edition's life, including every subsequent call to the one admin endpoint
built to fix exactly this class of problem.

**Fix:** added a second unconditional repair pass, `repairStaleBackfillContracts`
(`post-publish-backfill.ts`), run at the same placement as the existing `syncOutcomeRows` pass —
*before* the `minPlays` early-return, so it fires on every call regardless of whether the edition
also needs new plays appended. It scans `existing.plays` for any `selection_tier: "BACKFILL"` play
whose own contract has expired relative to `editionFor` (parsed via the existing
`parseOptionsContract`), fetches fresh chains for just those tickers, and hands off to a new pure
function, `repairStaleBackfillPlays` (`play-backfill.ts`, sibling to `selectBackfillPlays` — chains
are an input, same "no network inside the testable function" split every function in that file
already uses). For each stale play it either re-picks a live replacement contract via the
already-fixed `pickAffordableChainContract` (same #6631 expiry floor, so a repaired pick can never
itself be stale) or drops the play entirely when nothing qualifies — the same skip-rather-than-
placeholder discipline `selectBackfillPlays` already applies when backfilling a thin edition in the
first place, never a fabricated contract. If a drop pushes the edition back below `minPlays`, the
existing append-new-plays logic (fed the now-repaired `finalPlays`) picks up the slack exactly as it
already does for a genuinely thin edition — the two repair mechanisms compose without any special-
casing. `RepublishBackfillResult`'s `noop_already_at_minimum` and `backfilled` variants both now
carry `repairedTickers`/`droppedTickers` so a caller or log line can see a repair happened even on
an otherwise-unremarkable "noop" response — previously that information had nowhere to go.

**Blast radius:** scoped entirely to `republishBackfilledEdition`'s own already-published-edition
repair path. `backfillThinEditionPlays` (the live evening-edition build's own 3 backfill call
sites) is untouched — it builds a fresh edition from scratch every time, so there is no
"already-published-and-now-stale" state for it to repair; the gap only exists for an edition that
has *already* been persisted and is being revisited later, which only `republishBackfilledEdition`
does.

**Fix rationale — what was deliberately left unchanged:** the repair is BACKFILL-only, mirroring
the admin route's own existing scope boundary ("never touches an already-published QUALIFIED
play") — an organically-QUALIFIED play went through the real discovery/scoring pipeline and its
contract is the pipeline's actual pick, not backfill's synthetic one; if that ever goes stale too
it is a different, unaudited failure mode, not this one, and conflating the two would widen this
fix well beyond what the live repro demonstrated. The repair also does not attempt to re-validate
anything besides contract expiry (e.g. it does not re-check liquidity/affordability against the
*original* publish-time snapshot) — `pickAffordableChainContract` already re-applies every one of
its own filters (ask ceiling, OI floor, expiry floor) against the *fresh* chain fetch, so a repaired
pick is fully re-validated on every dimension that function checks, not just expiry.

**Evidence:** 5 new regression tests in `play-backfill.test.ts` reproduce the exact live PLTR shape
(re-pick from a fresh chain), plus: drop-when-unresolvable, untouched-when-still-live,
QUALIFIED-plays-out-of-scope, and SHORT/put-side repair. RED confirmed via `git stash` of
`play-backfill.ts` (the 5 new tests fail with `repairStaleBackfillPlays is not a function`; all 25
pre-existing tests in the file still pass), GREEN restored after `git stash pop`. Full suite on
Node 20: 16695/16698 pass, 0 fail, 3 skipped. `tsc --noEmit` clean.
