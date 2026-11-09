# 2026-11-09: GET /api/market/spx/desk hard-502s on a non-ServerCacheTimeoutError, while the sibling /play route degrades to 200 for the identical root cause

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

`src/app/api/market/spx/desk/route.ts`'s catch block had exactly one honest-degrade branch,
gated on `error instanceof ServerCacheTimeoutError`:

```ts
if (error instanceof ServerCacheTimeoutError) {
  const stalePeek = await peekSpxDesk().catch(() => null);
  if (stalePeek && stalePeek.price > 0 && stalePeek.source !== "none") { ...200... }
  const shell = deskShellFromPulse(await buildSpxDeskPulseMinimal());
  ...200...
}
return NextResponse.json({ available: false, error: "Desk build failed" }, { status: 502 });
```

Any OTHER thrown error type fell straight through to the hard `502`. This is the EXACT bug class
already fixed the same day at the sibling `/api/market/spx/play` route (PR #7791,
`docs/audit/findings-staging/2026-11-09-spx-play-catch-block-stale-desk-warming-default.md`) —
that finding file explicitly scoped its own fix to ONLY `play/route.ts`, leaving `desk/route.ts`'s
own catch-all 502 as a named follow-up. This is that follow-up.

Confirmed live during this session's audit: `GET /api/market/spx/desk` returned a hard
`502 {"available":false,"error":"Desk build failed"}` at `2026-11-09T18:10:31.263Z` and again at
`2026-11-09T18:13:00.179Z`, while `GET /api/market/spx/play` returned a graceful `200` degraded
payload at the same instants, for the same root cause (both routes sit behind the same
`loadSpxDesk()`/`buildSpxDesk()` build chain).

## Root cause

`loadSpxDesk()` (`src/features/spx/lib/spx-desk-loader.ts`) calls `withServerCache(key, ttl,
buildSpxDesk, deskCacheOpts)` (`src/lib/server-cache.ts`). On a cold cache key, `withServerCache`
races `Promise.race([refreshCache(...), timeoutPromise])`; `refreshCache` calls the loader
(`buildSpxDesk`) and re-throws on rejection. `opts.fallback()` is only invoked in the
`raced === "timeout"` branch — if `buildSpxDesk()` rejects FAST (a plain `Error`, e.g. an
unwrapped Polygon/Massive 403 from the real-time-snapshot entitlement outage CLAUDE.md's
2026-11-07/08 notes track, well under `withServerCache`'s own `maxBlockMs` budget), the raw
rejection wins the race immediately and `ServerCacheTimeoutError` is never constructed. The
unwrapped error propagates straight to the route's catch block, where `instanceof
ServerCacheTimeoutError` is false and the route fell through to the literal 502 — a false outage,
since the sibling `/play` route already degrades to 200 for the identical underlying rejection.

This is the same TYPE-vs-TIMING gap the `/play` finding above documents in full (`/play`'s own
catch block only overrode its degraded defaults on `ServerCacheTimeoutError`, missing the common
case where the eval chain throws a real error fast rather than timing out) — `/desk`'s catch block
had the identical shape, one route over.

## Evidence (RED → GREEN)

RED (pre-fix, `route.ts` manually swapped back to its pre-fix content via a plain file-copy
backup/restore — not `git stash`, per CLAUDE.md's shared-stash-stack risk note for this sandbox —
regression test left in place):

```
not ok 4 - spx/desk route: catch block applies the honest degraded fallback for ANY caught error,
           not just ServerCacheTimeoutError (2026-11-09 fix)
error: 'the stale-peek fallback must not be gated on error instanceof ServerCacheTimeoutError'
```

GREEN (post-fix, `route.ts` restored from the fixed backup):

- `src/app/api/market/spx/desk/route.test.ts`: 4/4 pass (3 pre-existing + 1 new).
- Full touched-file set (every `*.test.ts` under `src/features/spx/lib/` plus
  `spx/desk/route.test.ts`, `spx-issues-sync/route.test.ts`, `server-cache.test.ts`,
  `largo-terminal.test.ts`, `largo/contract/session-anchor.test.ts`,
  `market-api-auth-premium-gate.test.ts`, `providers/unusual-whales.test.ts`,
  `uw-ws-cache-bridge.test.ts`, `web-boot-warm*.test.ts`, `admin-spx-health.test.ts`,
  `bie/spx-desk-brief.test.ts`, `flow-liveness.test.ts`, `hooks/usePulseStream.test.ts`): 321/321
  pass, 0 fail.
- `npx tsc --noEmit`: clean.

All test/tsc runs performed on Node 20.20.2 (`/opt/nvm/versions/node/v20.20.2/bin`), per
CLAUDE.md's Node-version note.

## Fix

Removed the `error instanceof ServerCacheTimeoutError` gate around the stale-peek ->
pulse-minimal-shell fallback chain — that chain (unchanged itself: `peekSpxDesk()` first, falling
back to `deskShellFromPulse(await buildSpxDeskPulseMinimal())`) now runs unconditionally for EVERY
caught error, not only `ServerCacheTimeoutError`. This exactly mirrors `/play`'s already-shipped
fix: the data served on success is completely unchanged, only the catch block's gating condition
is widened.

Kept the `error instanceof ServerCacheTimeoutError` check, but demoted it to a diagnostic-only
distinction inside the existing `console.error(...)` call (tags the CloudWatch log line as
"(cache/fallback chain timeout)" vs "(desk build threw)") — useful for triage, no longer a gate on
correctness. The pre-existing test `"spx/desk route: ServerCacheTimeoutError degrades to 200 (not
502)"` (which only asserts the string `instanceof ServerCacheTimeoutError` appears somewhere in
the file, alongside `buildSpxDeskPulseMinimal`/`deskShellFromPulse`) stays green unmodified.

### New safety net — a real gap this fix also had to close

Unlike `/play`'s fallback (`degradedPlayPayload()`, a pure synchronous object builder with nothing
left to throw), this route's fallback chain calls `buildSpxDeskPulseMinimal()`, which does REAL
async network reads (`fetchPulseLaneSnapshots`, `priorDayForPulseLane`, `vixPriorDayForPulseLane`,
`spxPriceFromSpyProxy`) that can genuinely reject. Before this fix, that call was never wrapped in
its own try/catch — a failure there (reachable only via the narrow `ServerCacheTimeoutError`
branch pre-fix) would have escaped the whole catch block as an uncaught rejection, surfacing as a
generic framework 500 rather than the route's own controlled 502. Now that the SAME call is
reachable for every caught error (a materially wider surface), this fix wraps the entire fallback
chain in its own `try { ... } catch (fallbackError) { ...502... }`, so the literal 502 is still the
true last resort — reached only when the fallback chain itself throws — rather than disappearing
into an unhandled 500.

### Fix rationale — why mirror `/play`'s gate-widening rather than anything deeper

The task was explicitly scoped to this one catch block, mirroring `/play`'s already-reviewed and
shipped pattern as closely as this route's own existing fallback logic allows:

- Minimal and additive: no change to what is served on success, no change to the fallback chain's
  own logic (stale-peek-first, pulse-minimal-shell second), only to when it runs and what happens
  if it itself fails.
- Consistent with `/play`: both sibling routes sitting on the same `buildSpxDesk()` build chain now
  apply the same "reaching this catch block always means the build didn't finish — never gate the
  honest response on WHY" rule, closing the exact asymmetry this finding opened with.
- The new inner `try/catch` is the one genuinely new piece of logic (not present at `/play`,
  because `/play`'s fallback has nothing left to throw) — added because widening the outer gate
  meaningfully increases how often `buildSpxDeskPulseMinimal()`'s real network reads are reached,
  and leaving it unguarded would have traded one false-502 bug for an occasional false-500 one.

## Blast radius

One file's catch block (`route.ts`) plus its regression test (`route.test.ts`, already existed for
this route — new test appended alongside the 3 pre-existing ones). No other call site reads this
exact catch block. `peekSpxDesk()`, `buildSpxDeskPulseMinimal()`, and `deskShellFromPulse()`
(`spx-desk-loader.ts`/`spx-desk.ts`) are unchanged — this PR only changes WHEN/how route.ts calls
them, not their own logic. `/play`'s route (already fixed in PR #7791) is untouched.

## Deliberately left unchanged

- Did **not** touch `src/app/api/market/spx/play/route.ts` — already fixed (PR #7791), out of
  scope here by the task brief.
- Did **not** touch `src/features/spx/lib/spx-desk.ts`/`buildSpxDesk()` or any individual
  provider-fetch call site, even though that is where the actual throw most plausibly originates
  (per the live Polygon/Massive entitlement-outage notes in CLAUDE.md). This finding only fixes how
  `desk/route.ts`'s catch block PRESENTS an already-thrown error, not what throws it.
- Did **not** add a test that behaviorally invokes `GET()` with a mocked `loadSpxDesk()` throwing a
  live object — mirrored this route's own pre-existing `route.test.ts` convention instead (source-
  text assertions against the catch block's exact shape, verified RED against the real pre-fix
  source via a file-copy backup/restore, then GREEN against the fix), the same verification style
  the sibling `/play` fix (PR #7791) used and shipped with.
