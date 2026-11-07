# Legacy marks member-facing route never got the cache-fallback fix — FIXED

> **kind:** FINDING

## Symptom
`GET /api/market/nighthawk/legacy-marks` — the route the Command Deck UI actually polls every
2.5s (`useLegacyOptionMarks`) — returned `{mark:null, bid:null, ask:null, asof:null, stale:true}`
for all 19/19 real currently-open Legacy positions checked live (2026-11-07), the exact
"all-null on provider failure" symptom PR #7517/#7522 was supposed to have fixed.

## Root Cause
PR #7517 added a Redis cache fallback (serve a stale-but-present mark when both WS and REST fail
for an OCC with a prior successful fetch) to `fetchLegacyOptionMarksServer()` in
`src/features/nighthawk/lib/legacy-option-marks-server.ts`. That function has exactly two
callers: the `legacy-live-sync` cron and Discord trade-notify.

`src/app/api/market/nighthawk/legacy-marks/route.ts` — the member-facing API route — never
called that function. It carried its own, separate inline copy of the same WS-first/REST-fallback
logic (its own file header even said "Mirrors /api/market/nighthawk/legacy-marks" from the other
file's perspective, i.e. the duplication was already known and named). The cache-fallback fix
landed in one of the two copies and not the other, so the route members actually poll never
gained the protection the PR's own write-up claimed ("UI already knows how to render the stale
indicator" — true, but the route never produced a cache-backed `stale:true` row for it to render).

This is the identical failure *shape* — one WS/REST-staleness bug, two near-identical
implementations, one gets the fix — that these same two files already hit once before (2026-09-16,
the `LEGACY_QUOTE_STALE_MS` vs `ZERODTE_MARK_STALE_MS` bug, fixed in both files independently that
day).

## Fix
Deleted the route's inline WS+REST implementation entirely and had it call
`fetchLegacyOptionMarksServer(occs, { includeStale: true })` directly — the same function the cron
and Discord notify already use. Added `asof: string | null` to `LegacyServerOptionMark` and the
function's output (`out.set(...)`), since the route's consumer (`overlayLegacyOptionMarks`,
`use-legacy-option-marks.ts`) reads `row.asof` for `markAsOf` and the shared function previously
dropped that field from its return value.

Now there is exactly one WS+REST+cache-fallback implementation for Legacy option marks, used by
all three call sites (cron, Discord, member-facing route) — the same class of bug can't recur by
one copy getting a fix the other doesn't, because there's only one copy.

## Blast Radius
- `src/app/api/market/nighthawk/legacy-marks/route.ts` — rewritten to delegate.
- `src/features/nighthawk/lib/legacy-option-marks-server.ts` — `asof` added to the output type/map.
- No other call sites of either file needed changes; `legacy-live-sync` cron and
  `legacy-discord-trade-notify.ts` are unaffected (same function, same behavior for them).

## Evidence
- Live repro (pre-fix): `GET /api/market/nighthawk/legacy-marks?occs=<19 real open OCCs>` → 19/19
  `{mark:null,...,stale:true}`.
- `npx tsc --noEmit` clean after the change.
- `legacy-marks/route.test.ts` (2/2) + `legacy-option-marks-server.test.ts` (5/5, incl. two new
  tests added here) pass.
- Full nighthawk + market/nighthawk + legacy-live-sync test suite: 2205/2205 pass.

## Fix rationale
Delegating (rather than copy-pasting the cache-fallback logic into the route a second time) was
chosen specifically because copy-pasting is what caused this bug in the first place — a third
duplicate would just be a third thing to forget to fix next time. `includeStale: true` is required
on the route's call since members should see a stale-but-present mark (with the UI's existing
stale indicator) rather than have the row disappear entirely, which is what the shared function
does by default for cron-side callers that prefer to skip stale rows.

| **Status** | Fixed in PR (this commit) |
