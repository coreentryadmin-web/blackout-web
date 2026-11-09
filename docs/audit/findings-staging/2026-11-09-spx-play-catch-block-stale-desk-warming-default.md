# 2026-11-09: GET /api/market/spx/play's catch block still claimed "desk is cold/closed" for any error that isn't a ServerCacheTimeoutError

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

`src/app/api/market/spx/play/route.ts`'s catch block only
overrides `degradedPlayPayload()`'s honest-message extras when `error instanceof
ServerCacheTimeoutError`. Any OTHER exception thrown by `getSpxPlayState()` fell through to the
BARE `degradedPlayPayload()` defaults (`src/features/spx/lib/spx-play-payload.ts`), which claim:

- `headline`/`idle_message`: `"Desk warming — play state unavailable"`
- `session_phase`: `"closed"`

This is the exact same false "the desk itself is cold" claim the repo's own 2026-10-16/10-21/10-26
fixes already removed from the `ServerCacheTimeoutError` branch specifically — those fixes never
covered a non-`ServerCacheTimeoutError` exception, so the pre-fix bare text was still reachable
live through that gap.

Confirmed live during this session's audit at `2026-11-09T15:35:46-48Z`: `GET
/api/market/spx/play` returned `headline:"Desk warming — play state unavailable"`,
`session_phase:"closed"`, `degraded:true` — at the same moment (same poll batch, ~1-2s apart), `GET
/api/market/spx/desk` returned `available:true`, `market_open:true`, `market_status:"open"`,
`market_label:"RTH OPEN"`, `price:7352.9`. Reproduced 2 of 4 polls in one batch and 3 of 7 polls
total across a ~10-minute live audit window.

## Root cause

`withServerCache` (`src/lib/server-cache.ts`) throws `ServerCacheTimeoutError` in exactly two
narrow places: when a cold-start build races `opts.maxBlockMs` and loses with nothing usable to
serve (line ~534), and when an already-inflight build's fallback races `opts.maxBlockMs` and loses
(line ~483). In every other path — including the COMMON case where the wrapped loader
(`evaluateSpxPlayStateCrossReplica` → `evaluateSpxPlayState`, in `src/features/spx/lib/
spx-service.ts`) itself throws a real, non-timeout error — `withServerCache`'s internal
`Promise.race([refresh, timeoutPromise])` rejects **immediately** with that raw error the instant
the loader's promise rejects, rather than waiting for the timeout to fire. `evaluateSpxPlayState`
runs behind `evaluateSpxPlayStateCrossReplica()`, whose `try { ... } finally { ... }` has no
`catch` — any error the eval chain throws (e.g. a provider fetch deep inside `loadMergedSpxDesk()`/
`buildSpxDesk()`) propagates completely unwrapped, as whatever error class the throwing call site
used (typically a plain `Error` — see `src/lib/providers/polygon.ts`'s `throw new Error(\`Polygon
${path} → ${res.status}\`)` pattern on a non-2xx response).

`playMemberReadMaxBlockMs()` defaults to 800ms (`src/lib/providers/config.ts`). An HTTP error
response (e.g. a 403) typically returns in well under that budget, so a fast-failing upstream call
reliably wins the `Promise.race` before `ServerCacheTimeoutError`'s own timeout path ever engages
— meaning this gap is not a rare race, it is the NORMAL outcome whenever the eval chain throws
instead of hanging.

Best-confidence identification of the exception type (not pinned down exactly — this agent could
not inspect live server logs from the sandbox, consistent with the task brief): most plausibly a
plain `Error` from a Polygon/Massive provider fetch somewhere inside `evaluateSpxPlayState()`'s
`loadMergedSpxDesk()`/`buildSpxDesk()` call chain, rejecting on a 403 "not entitled" response —
consistent with CLAUDE.md's own 2026-11-07/08 entries tracking an ongoing Polygon/Massive
real-time-snapshot entitlement outage (`/v3/snapshot` family) active on the exact date/time this
bug was reproduced. `buildSpxDesk()` wraps most of its individual provider calls in `.catch(() =>
...)` fallbacks, but not universally — e.g. the `canonicalGex`/`uwWsLanes`/`macroEventsResolved`
branch of its big `Promise.all` (spx-desk.ts, around the `resolveCanonicalDeskGex`/
`fetchVixIvRankPercentile`/`resolveMarketTide`/`resolveFlow0dte`/`resolveDarkPool` calls) has no
`.catch()` at that call site, any one of which rejecting would propagate the same way. This PR does
not change `spx-desk.ts`/`buildSpxDesk()` itself (a separate agent is working adjacent SPX files
this same cycle, per task scope) — the fix below is deliberately independent of pinning down the
exact throw site, because it corrects the catch block's behavior for ANY exception reaching it, not
just the one this session could name with full confidence.

### Why the three prior dated fixes didn't catch this

Each of the 2026-10-16/10-21/10-26 fixes (see route.ts's own inline comments) correctly diagnosed
and fixed a specific symptom of the `ServerCacheTimeoutError` case — but all three gated their
honest-override logic on `error instanceof ServerCacheTimeoutError` specifically, treating that one
named subclass as a stand-in for "the eval pipeline failed to produce a result," rather than
treating ANY caught error here the same way. `spxPlayReadDegraded()` (the sibling degraded call
site in `spx-service.ts`, reached on ordinary lock-contention) already applies its honest override
**unconditionally**, regardless of cause — this route's catch block was the one remaining call site
still gating on error type instead of matching that unconditional pattern.

## Evidence (RED → GREEN)

RED (pre-fix, route.ts manually swapped back to its pre-fix content via a plain file-copy backup —
not `git stash`, to avoid this sandbox's shared stash-stack risk across concurrent sessions per
CLAUDE.md's own environment notes — regression test left in place):

```
not ok 10 - GET /api/market/spx/play's catch block applies the honest degraded override for ANY
            caught error, not just ServerCacheTimeoutError (2026-11-09 fix)
error: 'peekMergedSpxDesk() must not be gated on error instanceof ServerCacheTimeoutError'
```

GREEN (post-fix, route.ts restored from the fixed backup):

- `src/features/spx/lib/spx-service.play.test.ts`: 16/16 pass (15 pre-existing + 1 new).
- Full touched-file set (`spx-service.play.test.ts`, `spx/desk/route.test.ts`,
  `spx-play-payload.test.ts`, `server-cache.test.ts`): 45/45 pass.
- `npx tsc --noEmit`: clean.
- `npx eslint` on both touched files: clean.

All test/tsc/lint runs performed on Node 20.20.2 (`/opt/nvm/versions/node/v20.20.2/bin`), per
CLAUDE.md's Node-version note.

## Fix

Removed the `error instanceof ServerCacheTimeoutError` gate around the `deskPeek`/`extras`
computation in route.ts's catch block — `deskPeek` is now always peeked
(`peekMergedSpxDesk().catch(() => null)`, same cheap non-blocking call as before) and `extras`
always spreads `degradedPlayCatchingUpMessage()` plus the derived `session_phase` when the peek
succeeds, for every caught error, not only `ServerCacheTimeoutError`. This exactly mirrors
`spxPlayReadDegraded()`'s existing unconditional pattern in `spx-service.ts`, so the two sibling
degraded-payload producers in this file's call graph (route.ts's catch block and spx-service.ts's
lock-contention fallback) are now consistent with each other.

Kept the `error instanceof ServerCacheTimeoutError` check, but demoted it to a diagnostic-only
distinction inside the existing `console.error(...)` call (tags the CloudWatch log line as
"(cache/fallback chain timeout)" vs "(eval pipeline threw)") — useful for triage, no longer a gate
on correctness. This also keeps the pre-existing test
`"GET /api/market/spx/play's catch block distinguishes a cache-timing race from a generic crash
(2026-10-16 fix)"` (which only asserts the string `instanceof ServerCacheTimeoutError` appears
somewhere in the file) green without weakening it.

### Fix rationale — why broaden the gate rather than widen `session_phase`'s type

The task brief offered two options: (a) broaden the honest-override gate to cover the realistic
non-timeout exception class, or (b) more robustly stop defaulting `session_phase` to `"closed"` in
the bare case at all, surfacing an honest "unknown" state instead. Went with (a) because:

- It is the minimal change that closes the actual gap (error TYPE, not error TIMING) without
  touching `SpxPlayPayload`'s `session_phase` type (`"premarket" | "cash" | "closed"`), which has
  several other consumers (`spx-play-verdict-bar.ts`'s `resolveMode()` chief among them) that would
  all need auditing for a new `"unknown"` value — out of scope for a route-catch-block fix.
- It exactly matches the ALREADY-ESTABLISHED, already-shipped pattern in this same file's sibling
  (`spxPlayReadDegraded()`), which already applies its override unconditionally. Option (a) makes
  the two call sites consistent; option (b) would have left them using two different philosophies
  for the same problem.
- When the desk peek itself fails (`deskPeek` is `null` — e.g. the entitlement outage also breaks
  the peek path), `extras` simply omits `session_phase`, and `degradedPlayPayload()`'s bare
  `"closed"` default is used as a last resort — same residual behavior as today when `deskPeek`
  fails under a `ServerCacheTimeoutError`. This PR does not change that residual fallback; it only
  ensures the peek is ATTEMPTED for every error, not skipped outright for every non-timeout one.

## Blast radius

One file's catch block (`route.ts`) plus its regression test (`spx-service.play.test.ts`). No
other call site reads this exact catch block. `spxPlayReadDegraded()` in `spx-service.ts` already
had the unconditional behavior this PR brings route.ts in line with, so it needed no change.
`degradedPlayPayload()`/`degradedPlayCatchingUpMessage()`/`currentSessionPhase()`
(`spx-play-payload.ts`) are unchanged — this PR only changes WHEN route.ts calls them, not their
own logic.

## Deliberately left unchanged / explicit overlap note

- Did **not** touch `src/features/spx/lib/spx-desk.ts`/`buildSpxDesk()` or any provider-fetch
  call site, even though the root-cause analysis above points there as the likely origin of the
  actual throw. Per this session's task scope, a separate agent is working
  `spx-play-engine.ts`'s closed-market branch and `spx-play-context.ts`'s live countdown fields
  this same cycle — `spx-desk.ts` is adjacent to both efforts and was left untouched to avoid
  collateral edits on a shared file; this finding only fixes how route.ts's catch block PRESENTS
  an already-thrown error, not what throws it.
- Did **not** widen `SpxPlayPayload["session_phase"]`'s type to add an "unknown"/"indeterminate"
  value for the (now rarer, peek-also-failed) residual case — see "Fix rationale" above.
- Did **not** add retry/backoff logic to the eval chain itself, or wrap the un-caught
  `Promise.all` branches inside `buildSpxDesk()` with `.catch()` fallbacks — that is a change to
  `spx-desk.ts`'s own error-handling posture, out of this PR's scope (route.ts's catch block +
  `spx-play-payload.ts`'s degraded-default logic only, per the task brief).
