# 2026-11-09: SPX desk still served the empty shell for 5+ hours after the SPY-proxy fallback deployed — fix only reached one of two paths

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

Earlier today (commits `25e7baa54`/`e1275f9f4`) `buildSpxDesk()`'s price-resolution chain got a
SPY-proxy last resort (`spxPriceFromSpyProxy()`) for when I:SPX's own Polygon/Massive endpoints
are entitlement-blocked (`/v2/aggs/ticker/I:SPX/prev` → 403, confirmed against the live production
key). That fix was real and deployed — but `GET /api/market/spx/desk` and `/api/market/spx/play`
kept serving the full empty shell (`price:0, available:false, source:"none"`) for over 5 hours and
13+ full deploy cycles afterward, confirmed via repeated live polls through a temp Clerk
admin+premium session with `as_of` advancing on every call (ruling out a frozen stale cache).

Found by this cycle's Ask Largo/5-engine live-monitor Workflow: 5 parallel live-audit agents swept
SPX Slayer/Legacy/0DTE/Swings/Largo, then 3 independent adversarial-verify agents each
independently re-polled production and re-read the source, unanimously confirming the live defect
(0/3 refuted it — one verify agent additionally caught a live 502 from the same route).

## Root cause

Today's fix only touched `buildSpxDesk()`. But `GET /api/market/spx/desk`/`/play` don't always
serve `buildSpxDesk()`'s own result — `spx-desk-loader.ts`'s `loadSpxDesk()` wraps it in
`withServerCache` with `deskCacheOpts.fallback = async () => deskShellFromPulse(await
loadSpxDeskPulse())`. Whenever that cache's `maxBlockMs` race is lost (now more likely, since the
fix added one more sequential network await on top of an already-parallel-fetch-heavy builder),
the route is served through the PULSE lane instead — `buildSpxDeskPulse()`'s off-hours branch
(`src/features/spx/lib/spx-desk.ts`, the `if (!rthOpen && !premarketPlan)` block), which anchors
exclusively to I:SPX's own daily-bars family (`priorDayForPulseLane`/`fetchPriorDayCached`/
`fetchTodaysOwnCloseIfSessionComplete`) with no SPY-proxy equivalent. Under the same entitlement
block, every one of those sources resolves null and the branch fell straight through to the empty
`closedPulse` shell. `buildSpxDeskPulseMinimal()`'s cold-replica race branch had the identical gap
in its own, shorter price chain (`spxSnap?.price ?? lastPulseForSignals?.price ?? prior.pdc ?? 0`).

`mergePulseIntoDesk(emptyDeskPayload(...), pulse)` (`deskShellFromPulse`) then reads
`price: pulse.price > 0 ? pulse.price : base.price` and `available: pulse.available ||
base.available` — with `pulse.price === 0` and `pulse.available === false`, both stay at the
empty-shell defaults, which is exactly the live symptom.

## Evidence (RED → GREEN)

RED (pre-fix, via `git stash` isolating only the source change): the two new regression tests plus
one updated pre-existing test (whose exact-text regex the fix's own formatting changed) failed —
3/18 in `spx-desk-offhours-spot.test.ts`.

GREEN (post-fix): 18/18 pass in that file; 959/959 pass across the full `src/features/spx/lib/*`
suite; `npx tsc --noEmit` clean.

Live production evidence (from the Workflow's adversarial-verify agents, 2026-11-09 ~07:05-07:09
UTC, 5+ hours and 13+ deploy cycles after the `buildSpxDesk()` fix's first successful deploy at
2026-11-09T01:58:13Z): `GET /api/market/spx/desk` → `{"available":false,"source":"none","price":0,...}`
on repeated polls with `as_of` advancing each time; `GET /api/market/spx/play` → `score:0,
headline:"Session closed"` (internally coherent given the empty desk). Direct Massive/Polygon
calls on the real production key, same moment: `GET /v2/aggs/ticker/SPY/prev` → 200 `c:735.29`;
`GET /v2/aggs/ticker/I:SPX/prev` → 403 `NOT_AUTHORIZED` — confirming the fallback's precondition
(SPY healthy, I:SPX entitlement-blocked) was genuinely active the whole time.

## Fix

Added the same `spxPriceFromSpyProxy()` last-resort fallback — already proven correct by today's
earlier fix and by `polygon-options-gex.ts`'s `resolveSpotSnapshotLastResort` precedent — to:
1. `buildSpxDeskPulse()`'s off-hours branch, right before it falls through to `closedPulse`.
2. `buildSpxDeskPulseMinimal()`'s cold-replica race branch's price chain, before the final `?? 0`.

Both are lazily evaluated (only reached once every faster, I:SPX-anchored source has already
failed), matching the original fix's own discipline of never spending the extra fetch when a
live/sticky price already exists. `buildSpxDeskPulseMinimal`'s race already has its own
`pulseTimeoutMs` ceiling via `Promise.race` against a timeout that resolves to `empty` — adding
one more fallback inside the raced branch cannot regress that bound; on timeout it still resolves
to `empty` exactly as before, and on a fast resolution it now recovers a real price instead of 0.

## Blast radius

Fixes the SAME user-facing gap for every consumer of `GET /api/market/spx/desk`/`/play` when
served through the pulse fallback path — SPX Slayer's desk panel, the trade-alert panel, and Ask
Largo's `get_spx_confluence` tool (all three read off `buildSpxDesk()`/`loadSpxDesk()`). No other
fields (pdh/pdl/change_pct/etc.) are touched — same price-only scope as the original fix, since a
single SPY close cannot honestly supply those.

## Why this wasn't caught by the earlier fix

The earlier fix (and its own regression tests) only exercised/asserted `buildSpxDesk()`'s own
price chain. Nothing in that PR traced which of the two cache paths (`buildSpxDesk()` directly vs.
`deskShellFromPulse(loadSpxDeskPulse())`'s fallback) actually serves a live request under
contention — the live symptom only surfaces when the fallback path wins the race, which this
sandbox's earlier isolated `fetchPreviousDayBar` test couldn't have caught since it never
exercised the real route end-to-end against a cold/contended cache.
