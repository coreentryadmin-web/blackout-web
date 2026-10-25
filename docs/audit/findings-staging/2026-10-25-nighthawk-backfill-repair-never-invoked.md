## 2026-10-25 — [FINDING, P1 Night Hawk Legacy] `repairStaleBackfillContracts` shipped as an admin-only, manually-triggered action with no automatic caller — a dead options contract stayed live in the member-facing edition for a full day — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Area** | Night Hawk Legacy next-day digest edition (`src/features/nighthawk/lib/post-publish-backfill.ts`, `src/app/api/admin/nighthawk/republish-backfill/route.ts`) |
| **Found by** | 5-ENGINE LIVE MONITOR CYCLE standing Ask Largo audit mandate, parallel Workflow sweep on 2026-10-25 |
| **Status** | FIXED |

### Symptom

Live production, 2026-10-25: `GET /api/market/nighthawk/edition` (edition_for "2026-10-26", published
2026-10-23T21:40:16Z) served a BACKFILL-tier play recommending **"PLTR $197.5 Call 2026-10-23"** —
an options contract that expired three days before the edition's own target trading day, and even
before "today." Independently verified: `GET /api/market/nighthawk/legacy-marks` for that contract's
resolved OCC returned `{mark:null, bid:null, ask:null, asof:null, stale:true}`, while the edition's
other two plays (CRWD, NET) resolved with real, live marks.

This is NOT a new regression — it is the **exact same incident** PR #6637 (2026-10-24) documented in
its own commit message, on the **exact same edition** (edition_for "2026-10-26"), re-discovered live a
full day later by this cycle's audit.

### Root cause

PR #6637 shipped `repairStaleBackfillContracts`/`republishBackfilledEdition`
(`post-publish-backfill.ts`) — a function that correctly re-picks or drops any BACKFILL play whose
contract has expired relative to the edition's own target trading day. But the **only** caller of
`republishBackfilledEdition` anywhere in the codebase (confirmed via repo-wide grep) is
`POST /api/admin/nighthawk/republish-backfill` — an admin-only, manually-triggered, one-shot route.
Nothing invokes it automatically: no cron, no hook inside the edition GET route, nothing. #6637
shipped the repair *capability*; it never shipped an automatic *caller*. The admin endpoint was
simply never actually invoked against this specific edition after #6637 merged, so the identical
dead contract sat in the member-facing payload for a full extra day, confirmed by the fact that the
exact ticker, strike, and expiry match #6637's own "Live repro" verbatim.

### Blast radius

Any already-published edition whose BACKFILL contract expires before, or on, the edition's own
target trading day is affected identically — this is not specific to PLTR or to this one edition.
An edition published before PR #6631's generation-time expiry floor deployed is especially exposed
(that guard only protects *newly generated* editions), but the gap is general: nothing re-validates
an *already-published* edition's BACKFILL contract liveness on any recurring basis.

### Fix rationale

Two existing crons were considered and rejected as the wiring point:
- `nighthawk-morning-confirm` — its own header comment explicitly states "The edition ROW
  (nighthawk_editions.plays) is still never mutated" by that route's logic (the pull latch lives on
  the outcome row instead). Calling `republishBackfilledEdition` — which writes the repaired `plays`
  back to the edition row — from inside that route would directly contradict its own documented
  invariant.
- `nighthawk-edition` (the evening discovery/scoring/publish pipeline for the *next* edition_for) is
  the wrong shape entirely: it is a complex, checkpointed, fire-and-forget background build for a
  future edition, not a repair pass on an edition already published and approaching its own trading
  day. Bolting an unrelated repair step onto its job-staging logic would be scope creep on a
  sensitive pipeline.

Instead, added a new, single-purpose cron (`src/app/api/cron/nighthawk-backfill-repair/route.ts`)
that does nothing but call the already-shipped, already-idempotent `republishBackfilledEdition` for
today's edition, scheduled 15 minutes before `nighthawk-morning-confirm`'s own dual-band (9:00 AM ET
vs 9:15 AM ET, same DST-coverage shape) so any repair is already persisted by the time morning-confirm
reads the edition row. Reuses every gate (`isCronAuthorized`, `isTradingDayEt`, `inEtWindow`,
session-match) from the exact same established patterns in `nighthawk-outcomes`/
`nighthawk-morning-confirm` rather than inventing new ones. Alerts ops on Discord only when something
was actually repaired or dropped — never on the overwhelmingly common clean no-op (matching
`repairStaleBackfillContracts`'s own design intent: "must stay cheap on the overwhelmingly common case
where there is nothing to repair").

### Outstanding follow-up (narrowed — most of the work is already done)

Registering the cron in `cron-registry.ts` alone only updates a mirror; `railway.<key>.toml` is the
real in-repo source of truth `blackout-infra/scripts/sync-cron-schedules.mjs` reads
(`src/lib/cron-registry-schedule.test.ts` enforces this — missing the TOML is what made this PR's
own test suite fail on first push, caught and fixed in the same PR by adding
`railway.nighthawk-backfill-repair.toml`). Ran `sync-cron-schedules.mjs` locally against this
branch and confirmed the exact, minimal `cron-jobs.json` diff it produces (one 6-line entry,
inserted alphabetically before `nighthawk-morning-confirm`, matching every sibling entry's shape
exactly, verified against `terraform/modules/crons/main.tf`'s actual field usage). Opening that PR
against `blackout-infra` requires push access this session's permission classifier correctly denied
as a real access-scope elevation — the exact snippet is saved for a human or a future
blackout-infra-authorized session to apply directly (see `docs/audit/MARKET-OPEN-VALIDATION.md`'s
entry for the precise JSON). After that PR merges, a `terraform apply` against that module (by a
human or a future AWS-credentialed session — none available here) still creates the real
EventBridge rule; merging the JSON change alone does not. Until then the route is reachable only via
`?force=1`.

### Evidence / tests

New regression test `src/app/api/cron/nighthawk-backfill-repair/route.test.ts` (6 tests, source-text
assertions matching this repo's established style for cron route tests — see
`nighthawk-outcomes/route.test.ts`): gate ordering (auth → trading-day → window → session-match →
repair), `force=1` bypass of every gate, reuse (not reimplementation) of the repair logic, Discord-
alert-only-when-repaired, schedule ordering vs `nighthawk-morning-confirm`, and try/catch isolation.
`src/lib/cron-registry.test.ts` (4/4, including the two-way registry↔route consistency checks) and
the existing `post-publish-backfill.test.ts`/`play-backfill.test.ts`/`nighthawk-edition/route.test.ts`/
`nighthawk-outcomes/route.test.ts` all pass unchanged (53/53 across the full scoped run). `tsc
--noEmit` clean. Full suite run on Node 20 (`npm test`) confirmed green.
