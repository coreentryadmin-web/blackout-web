> **kind:** FINDING

## Night Hawk Legacy: a 100%-dossier-fetch starved funnel had NO automatic recovery path left between the evening cron window closing and market open — FIXED

**Status:** Fixed, regression tests added (`src/app/api/cron/nighthawk-backfill-repair/route.test.ts`,
`src/features/nighthawk/lib/session.test.ts`).

### Re-verification against current source (before fixing)

A live-audit cycle flagged `GET /api/market/nighthawk/edition` (no date param — the board members
actually see) returning `edition_for:"2026-11-02"`, `recap_only:true`, `no_plays:true`,
`funnel:{candidates:20, ranked:0, dossiers:0, synthesized:0, critic_passed:0, published:0}`,
`recap_only_reason:"No scored dossiers after 2 dossier-fetch attempt(s) (20 candidate(s))."`, with
`?date=2026-10-28` reproducing the byte-identical shape. Re-verified against `main` (not trusted at
face value, per this repo's own standing instruction) rather than assumed real:

- `src/features/nighthawk/lib/edition-builder.ts` (STAGE 3, lines ~876-918) confirms the
  dossier-fetch retry fix from PR #6397 (`e26db4e1f`, "retry the dossier FETCH stage, not the pure
  rescore pass") is live and correctly targets the fetch stage — `MAX_DOSSIER_FETCH_ATTEMPTS = 2`
  retries `fetchAllDossiers` itself, not `rescoreDossier`. The evidence ("100% dossier-fetch
  failure across both retry attempts") is consistent with this fix *working as designed* and still
  not being enough — both attempts genuinely ran and both genuinely failed.
- `src/features/nighthawk/lib/edition-stale.ts`'s `shouldRetryRecapOnlyEdition` (PR #6286,
  `dfc876480`) — the SAME-EVENING retry — requires `inEditionWindow: true`
  (`isInEditionWindow()`, the 5:30-7:55pm ET dispatch window). The evidenced edition's
  `published_at` (`2026-10-31T00:00:23Z`) is ~15 minutes after `railway.nighthawk-playbook.toml`'s
  last scheduled fire (`30/15 21-23 * * 1-5` UTC, last tick 23:45 UTC = 7:45pm EDT) — i.e. this
  was already the LAST evening fire for the night, so no later fire exists to re-check
  `shouldRetryRecapOnlyEdition` before the window closes. Confirmed this is not special-cased
  anywhere else in the pipeline.
- `src/app/api/cron/nighthawk-backfill-repair/route.ts` (PRs #6665/#6637/#6631, the 9:00 AM ET
  morning cron) was the only remaining candidate for recovery before market open. Traced its only
  call, `republishBackfilledEdition` (`post-publish-backfill.ts`): when the existing edition's
  `plays.length < minPlays` (true for a zero-play recap-only edition), it reads
  `fetchNighthawkCandidateSnapshots(editionFor, { stage: "rank_governor" })` and returns
  `{ ok:false, status:"no_rank_governor_snapshot" }` if that list is empty — and it IS empty for
  this failure mode, because `edition-builder.ts`'s `!scoredList.length` branch (the recap-only
  publish path for a 100%-dossier-failure night) returns *before* STAGE 4 (ranking) ever runs, so
  no `rank_governor` snapshot row is ever written for the backfill mechanism to read back.

**Confirmed real**: between the evening window closing and the 9:00 AM repair cron, and even
through the repair cron itself, there was no automatic path to regenerate plays for an edition that
starved 100% at the dossier-fetch stage. This is a genuine, reproducible gap, not a one-off — the
exact same `no_rank_governor_snapshot` dead end applies to any future night with the same failure
shape, independent of root-causing *why* every dossier fetch failed (the leading theory throughout
this incident's documented history is transient UW rate-limiter congestion during the 5:30pm ET
build window; this fix does not depend on confirming that root cause, only on giving the board
one more real chance to recover before members open it).

### Fix

`nighthawk-backfill-repair/route.ts`: when `republishBackfilledEdition` returns
`status: "no_rank_governor_snapshot"`, dispatch ONE full pipeline rebuild —
`buildEveningEdition({ asOfEt: previousTradingDayEt(editionFor), force: true, persist: true })` —
in the background via `next/server`'s `after()` (same fire-and-forget shape
`nighthawk-edition/route.ts` already uses, wrapped in `runWithBackgroundUwSweep` so it reserves a
UW concurrency slot for live member traffic the same way that route's own dispatch does), instead
of falling through to the generic dead-end `{ ok:false, skipped:true }` no-op. Ops gets a Discord
alert (`notifyOpsDiscord`) either way so the attempt is visible.

- `force: true` is required: at 9am the job's `status` is `"published"` (the recap-only edition
  already published last night), and without `force` neither `shouldRebuildStalePublishedEdition`
  nor `shouldRetryRecapOnlyEdition` fires outside `isInEditionWindow()` — this is exactly the gap
  being closed.
- `asOfEt: previousTradingDayEt(editionFor)` is required because `buildEveningEdition` derives
  `edition_for = nextTradingDayEt(asOfEt)` internally; there is no direct "rebuild THIS edition_for"
  param. Verified this composes back to the original `editionFor` for both live-evidenced dates
  (`2026-11-02`, `2026-10-28`) and across a holiday boundary — new test in `session.test.ts`.
- `persist: true` is required because `asOfEt !== todayEt()` makes the build `historical`, which
  defaults to `dryRun` unless `persist` is explicitly set (the existing "admin recovery only" path
  `buildEveningEdition`'s own doc comment already documents).

### Why this doesn't risk a destructive double-rebuild

This cron fires twice (dual-UTC-band DST coverage, `0 13,14 * * 1-5`), and under EDT both fires can
land inside the 90-minute catch-up window, so this branch could run twice in one morning. No extra
guard was added because `buildEveningEdition`'s own existing job-status handling already prevents a
destructive re-reset while a build is mid-flight: its `force`-reset branch only fires when
`job?.status === "published"`; once the first dispatch flips the job to `"running"` (which happens
almost immediately after the response is flushed, long before the second fire an hour later), a
second `force:true` call falls through to the ordinary checkpoint-resume path instead of
archiving/resetting again — the same safety property the evening cron's own repeated 15-minute
re-dispatch already relies on.

### Evidence (RED -> GREEN)

New tests (source-inspection style, matching this file's own established precedent for a
multi-thousand-line pipeline function — see `edition-builder-dossier-fetch-retry.test.ts`):

- `nighthawk-backfill-repair/route.test.ts`: asserts the `no_rank_governor_snapshot` branch exists
  inside `!result.ok`, calls `buildEveningEdition` with `force:true`/`persist:true`/
  `asOfEt: previousTradingDayEt(editionFor)`, dispatches via `after(dispatchRebuild)` wrapped in
  `runWithBackgroundUwSweep`, and runs BEFORE the generic dead-end skip. Also repaired the
  pre-existing "alerts ops on Discord only when something was actually repaired or dropped" test,
  which would otherwise have started checking the WRONG (new, earlier) `notifyOpsDiscord({` call
  now that there are two in the file.
- `session.test.ts`: new test proving `nextTradingDayEt(previousTradingDayEt(X)) === X` for a
  trading day, across the two live-evidenced dates plus a holiday-weekend case.

RED->GREEN proven via a surgical revert (not `git stash`, per this sandbox's standing note that
concurrent agents share one working directory — stashing would have touched unrelated in-flight
changes from another session): saved a patch of both touched files, `git checkout --` only
`route.ts` back to its pre-fix `HEAD` content (leaving the new tests in place), ran the suite —
1/7 failed (`"the no_rank_governor_snapshot check must be inside the !result.ok branch"`) — then
re-applied the patch and re-ran: 7/7 pass. `src/features/nighthawk/lib/session.test.ts` was
likewise run standalone: 18/18 pass (pre-existing) + 1 new = still all green (the new assertion is
additive, not a RED case against prior code — `previousTradingDayEt`/`nextTradingDayEt` themselves
are unchanged).

Broader regression sweep (Node 20, `--experimental-test-module-mocks`), all green, no regressions:
`post-publish-backfill.test.ts`, `edition-stale.test.ts`, `nighthawk-edition/route.test.ts`,
`cron-registry.test.ts`, and the full `edition-builder*.test.ts` family (38 tests). `tsc --noEmit`
clean. `eslint` on every touched file: 0 errors/warnings.

### Blast radius

Two files touched for the fix (`nighthawk-backfill-repair/route.ts` + its test), one test-only
addition (`session.test.ts`). No change to `edition-builder.ts`, `post-publish-backfill.ts`, or the
admin `republish-backfill` route — `republishBackfilledEdition`'s contract and return shape are
completely unchanged, so the admin-triggered path (`POST /api/admin/nighthawk/republish-backfill`)
and its existing idempotency guarantees are untouched. The only new side effect is this one cron
now also dispatching a `buildEveningEdition` rebuild, and only in the one specific case
(`no_rank_governor_snapshot`) where the existing repair mechanism was already a dead end.

### Deliberately left unchanged / out of scope

- The actual upstream root cause of why every one of 20 dossier fetches failed (leading theory:
  transient UW rate-limiter congestion during the evening build window) — this fix gives the board
  one more real chance to recover regardless of cause, it does not diagnose or change the cause
  itself. This session has no AWS/CloudWatch access to pin that down (confirmed:
  `sts get-caller-identity` -> `InvalidClientTokenId`), consistent with every prior investigation of
  this same incident shape.
- `shouldRetryRecapOnlyEdition`'s cooldown/window logic itself — unchanged; the morning rescue is a
  separate, later-stage backstop, not a replacement for the same-evening retry.
- No new cron was added — this reuses the existing dual-band 9:00 AM ET schedule
  `nighthawk-backfill-repair` already has, per the standing "sequence/reuse existing dispatch
  points rather than adding new moving parts" discipline already established for this cron's own
  earlier `shouldRetryRecapOnlyEdition` fix.
