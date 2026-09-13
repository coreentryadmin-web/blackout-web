> **kind:** FINDING

## Night Hawk Legacy — DB fallback for morning-confirm status silently dropped plays lacking a pinned verdict — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 (member-facing status payload can under-report the edition after a 24h+ TTL expiry) |
| **Lane** | Night Hawk Legacy |
| **Found** | 2026-09-13, aggressive improvement-hunting sweep per the standing v3 mandate |

### What was broken

`GET /api/nighthawk/play-status` serves the morning-confirm verdict from a 24h Redis cache; once
that TTL expires, `morning-status-from-db.ts`'s `morningStatusFromDb` reconstructs the same payload
from the durable `nighthawk_play_outcomes.morning_verdict` pins instead of re-running the cron.

The live cron (`nighthawk-morning-confirm/route.ts`) builds its `PlayStatus[]` with
`plays.map((play) => ...)` — **every** edition play always gets an entry, and
`morning-confirm-verdict.ts` explicitly falls back to an honest `UNVERIFIED` status ("Zero checks
ran → the verdict is a statement about DATA, not the play... UNVERIFIED tells the member 'the desk
could not check this one'") when a play's data couldn't be checked.

`morningStatusFromDb`'s reconstruction loop did not mirror this: it looked up each edition play's
verdict and, when none was pinned (`if (!verdict) continue;`), **silently dropped that play from
the returned list entirely** instead of emitting the same honest UNVERIFIED entry. A member polling
status any time after the 24h Redis window expired for an edition where even one ticker's
`morning_verdict` never got pinned (a per-ticker Cortex/data error during the live 9:15 ET run)
would see a status list with fewer plays than the edition actually publishes — reading as "this
ticker was never on tonight's board" rather than "checked, but the desk couldn't verify it."

### Reachability

Confirmed the caller: `src/app/api/nighthawk/play-status/route.ts`'s `loadMorningStatusFromDb`
passes the edition's FULL play list (`rowToNightHawkEdition(editionRow).plays`) as
`editionPlays`, straight from `fetchNighthawkEditionByDate` — this is the real, live fallback path,
not a hypothetical. Any edition where the live cron's own Cortex/data checks partially failed for
one ticker (a real, already-handled case per `morning-confirm-verdict.ts`'s own UNVERIFIED branch)
would trigger this the moment the Redis cache aged out.

### Fix

Changed the reconstruction loop to push an UNVERIFIED `PlayStatus` (reason: "Morning confirm data
unavailable for this play — verdict withheld, treat as unvetted") for any edition play lacking a
pinned verdict, instead of skipping it — same honest-absence convention the live cron already uses,
so the DB fallback and the live/cached path can never silently disagree on how many plays exist.

### Evidence

RED→GREEN: the new regression test fails against pre-fix code (`1 !== 2` — the play list length),
verified via `git stash` on `morning-status-from-db.ts` alone; passes post-fix (3/3 subtests in the
file green, including the pre-existing "returns null when no readable verdicts exist" case,
unaffected). Full suite (Node 20): 14105/14105 pass, 0 fail, 3 skipped. `npx tsc --noEmit`: clean.

### Blast radius

One function, one caller (`/api/nighthawk/play-status`'s DB-fallback branch — the live-cache-hit
path is untouched). No schema/API shape changed: `PlayStatus` already had an `UNVERIFIED` status
value and an optional `checked_at`; this only completes an existing branch that was silently
skipped, matching the shape the live cron already produces for the identical case.
