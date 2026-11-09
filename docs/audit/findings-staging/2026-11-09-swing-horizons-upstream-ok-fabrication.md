# 2026-11-09: Swing/LEAPS `GET /api/market/nighthawk/horizons` fabricated `upstream_ok:true` and a fresh `board.asOf`, hiding real swing-data staleness from the engine-status badge

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

`GET /api/market/nighthawk/horizons?view=swings` (and the structurally-identical `?view=leaps`
code path — see the LEAPS scoping note below) always returned `upstream_ok: true` and a
request-time `board.asOf`, regardless of whether the swing discovery scan backing that board was
actually current. Live-confirmed 2026-11-09: the SAME response carried top-level
`board.asOf = "2026-11-09T17:08:18.714Z"` (request time) alongside
`board.lanes.SWING.scanAsOf = "2026-11-06T14:15:15.469Z"` — a real, live ~75-hour gap, consistent
with the Polygon real-time-snapshot entitlement outage this repo's `CLAUDE.md` already tracks as
still open as of 2026-11-08. `upstream_ok` was `true` throughout.

Client-side, `HorizonDeck` (`src/features/nighthawk/command-deck/containers.tsx`) wires
`boardAsOf`/`upstreamOk` straight into `CommandDeck`, which feeds `deriveEngineStatus`
(`src/features/nighthawk/command-deck/deck-engine-status.ts`): `opts.upstreamOk === false` is the
ONLY non-session-timing path to an "Offline" verdict. Since this field could structurally never be
`false` on the Swing/LEAPS scoped path, and `board.asOf` could structurally never read as stale
(always request time), the Swing Command engine-status badge could never show anything but
"Monitoring"/"Standby" no matter how stale the underlying discovery scan actually was — a live,
partial, or multi-day-stale swing-data condition was completely invisible to the badge. Meanwhile
`SwingCockpitStrip` (same file) independently renders the real `swingLane.scanAsOf` a few lines
below, so the SAME page could show a calm "Monitoring" header next to a visibly stale "scan as of"
timestamp underneath it.

## Root cause

`src/app/api/market/nighthawk/horizons/route.ts` takes a deliberate fast path for `?view=swings`/
`?view=leaps` that skips the live 0DTE board rebuild (`getZeroDteBoardPayload()`) — a genuine,
intentional latency optimization (P2-5), since the scoped Swing/LEAPS response zeros that lane
anyway. Because of this, `payload` stays `null` on this path, and the response used to compute:

```ts
let board =
  horizon === "SWING" || horizon === "LEAPS"
    ? assembleHorizonBoard(makePlaySet({}), new Date().toISOString())
    : null;
// ...
upstream_ok: payload?.upstream_ok ?? true,
```

Two structural consequences:

1. **`upstream_ok`** defaulted to `true` unconditionally whenever `payload` was null — which is
   ALWAYS true on this fast path. None of the real swing-pipeline functions
   (`readSwingServingSnapshot`, `discoverSwingFromPersisted`, `getSwingServingLane`, all in
   `src/lib/swing/serving-lane.ts`) ever fed a health signal into this field; it simply never had
   one wired in.
2. **`board.asOf`** was stamped to `new Date().toISOString()` — request time — on this same path.
   `withLane` (`src/lib/horizon-board.ts`), which splices the real `swingLane` into the board
   afterward, only re-derives `totalCommitted`/`totalWatch` from the three lanes; it never touches
   `board.asOf`. So the top-level field was tautologically always "fresh," independent of the
   swing lane's own real `scanAsOf`.

This is exactly the "degraded board painted as calm" failure mode the 0DTE path's own
`upstream_ok: upstream_ok && committedKnown` computation (`src/lib/platform/zerodte-service.ts`)
exists to prevent — but nothing on the Swing/LEAPS scoped path guarded against the identical
failure shape, because this path never populates `payload` at all.

## Evidence

Live repro (2026-11-09, via the production API): `GET …/horizons?view=swings` returned
`board.asOf: "2026-11-09T17:08:18.714Z"` and `upstream_ok: true` while the SAME response's
`board.lanes.SWING.scanAsOf: "2026-11-06T14:15:15.469Z"` — a ~75h real gap. Source reading against
current `main` confirms the mechanism exactly as described above (`route.ts` lines ~80-107,
~163-172 pre-fix).

RED → GREEN (via a temporary WIP commit + `git checkout HEAD~1 -- route.ts` isolation, keeping the
new tests — this sandbox's shared git-stash stack across worktrees makes a bare `git stash`
unsafe, so the fix file alone was reverted to its parent commit instead): with the pre-fix
`route.ts` restored and the new tests in place, 3 of 4 new tests in the
`swing/leaps fast path — upstream_ok/asOf honesty` describe block in
`src/app/api/market/nighthawk/horizons/route.test.ts` failed (`upstream_ok` stuck at `true` for a
stale/never-scanned lane, `board.asOf` stuck at request time instead of the real stale
`scanAsOf`). Restoring the fix: 14/14 tests in that file pass.

## Fix

Two changes, both scoped to the SWING/LEAPS fast path only (the `horizon === "SWING" ||
horizon === "LEAPS"` branch) — the 0DTE branch's existing `upstream_ok && committedKnown`
computation is untouched:

1. **`board.asOf`** is now overridden to `swingLane.scanAsOf` whenever that field is present,
   right after `swingLane` (the only real I/O on this fast path) is computed and spliced in. With
   no real scan timestamp at all (a lane that has never scanned), the pre-existing request-time
   fallback is left as-is — there is nothing truer to show.
2. **`upstream_ok`** is now derived as
   `swingLane.scanSessionDay != null && swingLane.scanSessionDay === mostRecentTradingDayEt()`.
   `scanSessionDay` is the ET session day the swing-discovery cron stamps the scan with — the
   exact field `dataFreshnessSection` (`play-brief-intel.ts`) already uses for the identical
   "is this scan current" question in the per-play brief. `mostRecentTradingDayEt`
   (`src/features/nighthawk/lib/session.ts`) is the same helper `GET /api/market/regime` already
   ships this precise pattern with (task #173: "stale whenever captured_at's ET calendar date
   isn't the current/most-recently-completed trading session... an unparseable/missing timestamp
   fails CLOSED rather than silently claiming freshness").

### Fix rationale — why a trading-day comparison, not a raw age cutoff

A fixed wall-clock-age threshold cannot cleanly separate "an ordinary weekend/holiday close" from
"this exact incident": the live incident's own gap (~75h) sits comfortably inside the range of an
ordinary long weekend/holiday gap the existing `SWING_SERVING_CACHE_KEY` TTL (120h) is already
sized to tolerate without eviction (see that constant's own header for the holiday-weekend math).
Any single age bound tight enough to catch 75h would also misfire on an ordinary 3-day weekend;
any bound loose enough to tolerate weekends would miss this incident. A trading-day comparison
sidesteps this: on a Saturday or Sunday, `mostRecentTradingDayEt()` returns Friday, matching
Friday's own last scan — no false "stale." On the real incident's day (a Monday, a trading day,
with no scan of its own having landed yet), it mismatches regardless of how many wall-clock hours
that represents — which is precisely the live incident. This exact comparison style (ET-date
equality against `mostRecentTradingDayEt()`, fail-closed on a missing/unparseable timestamp) is
already shipped, reviewed, and running in `GET /api/market/regime` (task #173) and
`src/features/nighthawk/lib/platform-intel-snapshot.ts` — reused rather than inventing a new
staleness convention for this one route.

### Known, disclosed limitation (not fixed here — out of scope)

Between midnight and the swing-discovery cron's first `PRE_OPEN` scan of a new trading day
(`SWING_SCAN_PHASES`, `scan-cadence.ts` — `PRE_OPEN` starts 06:00 ET), `scanSessionDay` still
carries the PRIOR trading day while `mostRecentTradingDayEt()` already reports the new one, so
this check will read `upstream_ok:false` for that ordinary ~6-hour overnight window every trading
night. This mirrors the identical, already-accepted behavior of the `GET /api/market/regime`
precedent this fix reuses (that route's own cron also only writes during its active window) and is
arguably honest rather than wrong — there genuinely is no fresh scan yet at that hour — but it does
mean `deriveEngineStatus`'s "Offline" branch (which takes priority over the session-timing-based
"Standby" branch) will render overnight on the Swing/LEAPS tab where it previously showed
"Standby." Flagged here for next-session awareness rather than solved in this PR, which is scoped
to disclosure only, not to rebalancing `deriveEngineStatus`'s own branch priority.

### LEAPS scoping note

The route's pre-existing (not introduced by this fix) `horizon === "SWING" || horizon === "LEAPS"`
check means this fix benefits "LEAPS" defensively too — but `?view=leaps` has been unreachable via
the route's own live query-param validator since 2026-08-04, when LEAPS was removed from
`NIGHTHAWK_VIEWS`/`KNOWN_NIGHTHAWK_VIEW_TOKENS` (`nighthawk-view.ts`'s own header: "the LEAPS
horizon lane has no live signal adapter feeding it yet"). `?view=leaps` 400s ("Invalid view")
today, confirmed while writing this fix's tests. No regression test exercises the LEAPS half
live for this reason; the fix stays correct-by-construction for whenever LEAPS is revived.

## Blast radius

One file changed (`src/app/api/market/nighthawk/horizons/route.ts`), one new import
(`mostRecentTradingDayEt` from `@/features/nighthawk/lib/session`, already used elsewhere in this
exact pattern — no new dependency). Affects every consumer of `GET …/horizons?view=swings` (and
the dormant `?view=leaps`): the Swing Command engine-status badge (`deriveEngineStatus` via
`HorizonDeck`/`CommandDeck`), and any Largo tool reading this route's `upstream_ok`/`board.asOf`
fields directly. The 0DTE (`?view=0dte` / default) path and its existing `upstream_ok` computation
in `zerodte-service.ts` are completely untouched — verified by a dedicated regression test
("the unscoped (0DTE payload) view is unaffected by swing scan staleness").

## What was deliberately left unchanged

- No change to what DATA is served on this path — only whether its real staleness is now visible.
  The swing lane's plays/sections/committed/watch are identical to before this fix.
- No change to the 0DTE branch's `upstream_ok`/`asOf` computation.
- No change to `deriveEngineStatus`'s own branch priority (the known overnight-window limitation
  above) — that is a separate, larger product decision about how "Offline" vs "Standby" should be
  weighted against session timing, out of scope for a disclosure-only fix.
- No new field added to `SwingServingLane`/`getSwingServingLane`'s return shape — `scanAsOf`/
  `scanSessionDay` already existed and already carried exactly the signal needed; this fix reuses
  them rather than adding a parallel health field.
