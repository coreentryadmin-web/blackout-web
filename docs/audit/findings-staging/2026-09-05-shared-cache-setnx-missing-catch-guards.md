> **kind:** FINDING

## `sharedCacheSetNx` fail-open fix (#3960) left 6 call sites with no `.catch()` — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Severity** | P2 (undocumented behavior change on transient Redis error, not an outage/crash risk) |
| **Area** | Discord dedup guards (Thermal, HELIX, Dark Pool) |

## Root cause

PR #3960 (CLQ-037/044) correctly stopped `sharedCacheSetNx` from silently swallowing a Redis
`SET NX` error and falling back to an in-memory acquire — before that fix, a Redis error meant
`sharedCacheSetNx` **always** returned `true` regardless of what any caller's own `.catch()` said,
which is what made `helix-alert-notify.ts`'s explicit fail-closed `try/catch` (written specifically
because "a Redis error is a hard skip, not a fallback-send") dead code.

That fix changed `sharedCacheSetNx`'s contract: a Redis command error now **rejects** the promise
instead of resolving `true`. Every one of the 19 production call sites needs an explicit `.catch()`
to choose fail-open or fail-closed — before the fix, ALL callers implicitly got fail-open for free.
#3960's own diff only touched `shared-cache.ts` and its test (2 files); it did not audit callers.

13 of 19 call sites already had an explicit `.catch(() => true)` or their own `try/catch` and are
unaffected. **6 had none**, so this PR shipped with those 6 silently inheriting a real behavior
change nobody decided on purpose:

- `src/app/api/cron/thermal-discord/route.ts:171` (15-min scheduled-snapshot dedup)
- `src/app/api/cron/helix-discord-digest/route.ts:93` (`claimDedup` — 15m/30m digest dedup)
- `src/app/api/cron/darkpool-discord/route.ts:154` (digest dedup)
- `src/lib/thermal-discord-eod.ts:28` (`claimThermalEodRecap`)
- `src/lib/darkpool-discord-notify.ts:33` (`claimDarkpoolDiscordPrint`)
- `src/lib/discord-eod-recap.ts:39` (`claimDiscordEodRecap`)

## Why this matters (blast radius)

None of the 6 crash — each route has its own outer `try/catch` (confirmed for `thermal-discord`,
returns a proper 500 + `logCronRun` failure) or is caught by Next.js's own route-handler error
boundary (a generic 500, no `logCronRun` bookkeeping). So there is no unhandled-rejection or
process-crash risk. But the *observable* behavior silently flipped: these are all pure
duplicate-post-tolerant dedup guards for scheduled Discord posts — the tested-in-production posture
is "post anyway on a transient Redis blip" (worst case: one duplicate post, harmless). Under #3960
as merged, a Redis blip during the dedup check now fails the **entire** cron run instead — the
scheduled Thermal/HELIX/Dark-Pool post is silently skipped for that cycle, which is a worse outcome
for a scheduled digest than an occasional duplicate.

## Fix

Added `.catch(() => true)` to all 6 call sites, matching the exact pattern already used by
`desk-warm`/`vector-pick-sweep`'s overlap locks and the 13 other already-guarded
`sharedCacheSetNx` callers — restores the pre-#3960 fail-open behavior for these specific
duplicate-tolerant guards without touching `shared-cache.ts` itself (that fix stands correct; see
this file's own history — #3960 was itself a real fix for a real latent bug in
`helix-alert-notify.ts`, just incomplete).

## Tests

Added regression tests for all 6 call sites (RED→GREEN proven via `git stash` on just the 6 source
files, keeping the new tests): 6/13 targeted tests failed pre-fix, 13/13 pass post-fix. Following
this repo's own established convention for testing this exact `sharedCacheSetNx` fail-open pattern
(source-text assertion on the raw file, same technique #3960's own `shared-cache.test.ts` used) —
real Redis isn't reachable in the test environment (no `REDIS_URL`), so a genuinely behavioral test
of "Redis connected but the command throws" isn't available; the source-text assertion proves the
`.catch(() => true)` guard is present and hasn't regressed, which is exactly what #3960's own test
proves for the removed fallback. `npx tsc --noEmit` clean.

## Fix rationale — what was deliberately NOT done

Did not touch `zerodte-service.ts:986` (`refreshSharedBoardInBackground`) or
`helix-alert-notify.ts:62` — both already have their own explicit `try/catch` with the right
semantics for their use case (skip-this-cycle and hard-fail-closed respectively), and #3960 made
the latter's fail-closed intent finally reachable instead of dead code. Did not change
`shared-cache.ts` itself — its new throw-on-error contract is correct; the gap was purely in
caller coverage.
