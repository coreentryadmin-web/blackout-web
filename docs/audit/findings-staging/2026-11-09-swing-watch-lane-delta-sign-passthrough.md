# 2026-11-09: Swing WATCH-lane PUT contracts still served the pre-#7604 positive delta sign — the persisted-snapshot passthrough never re-signs

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

Live `GET /api/market/nighthawk/horizons?view=swings` served the WATCH candidate TSLA 365P
(direction SHORT) with `contract.delta: 0.61` — a positive delta on a PUT, the exact bug and exact
repro (TSLA 365P, +0.61) PRs #7604 (2026-11-08) and #7650 (2026-11-09, "the 3 remaining pin/read
sites") were supposed to have already fixed everywhere. Found by this cycle's Ask Largo/5-engine
Workflow (unanimous 3/3 adversarial verify, 0 refuted).

## Root cause

`ChainContract.delta` is persisted as the ranker's ABSOLUTE MAGNITUDE convention (calls positive,
puts' magnitude — `contract-ranker.ts`'s own convention), never re-signed at write time. The
2026-11-08/09 fix wave re-signed at three read sites: `closed-plays.ts`'s `contractBundleFromRow`,
`live-plays.ts`'s live-quote fallback, and `roll-plan.ts`'s roll-child pin. `src/lib/swing/
serving-lane.ts`'s `discoverSwingFromPersisted` — the persisted-snapshot passthrough that serves
the WATCH lane — was the one remaining site: it spread each persisted play straight through
(`{...p, firstSeenAt: ..., signalKinds: ..., flagUnderlyingPx: ...}`) with no `contract` override.
Confirmed live: `GET /api/market/swing/record?days=90`'s `closedDeck` (which DOES recompute at read
time) correctly serves negative deltas for every closed SHORT/PUT, while the WATCH lane — the one
surface still doing a bare passthrough — kept serving the stale, wrong-signed snapshot value.

This isn't just "masked by a live quote" the way the 3 already-fixed sites could self-correct —
the WATCH lane's persisted snapshot (`SWING_SERVING_CACHE_KEY`, 120h TTL) was written by a scan
that ran at 2026-11-06T14:15:15Z, *before* #7604 even existed, so the wrong sign is baked into the
cached snapshot and architecturally immune to the fix until the next successful discovery scan
re-persists. Re-signing at this read site closes the gap unconditionally, regardless of snapshot
age — the same discipline the other 3 sites already use.

## Evidence (RED → GREEN)

RED (pre-fix, via `git stash` isolating only the source change): 1/31 tests failed in
`serving-lane.test.ts` (the new re-sign regression test).

GREEN (post-fix): 31/31 pass in that file; full `src/lib/swing/*` suite 2315/2315 pass;
`npx tsc --noEmit` clean.

Live production evidence (from the Workflow): `GET /api/market/nighthawk/horizons?view=swings`
served `swing.watch[0] = {ticker:"TSLA", direction:"SHORT", contract:{right:"P", delta:0.61,
strike:365, expiry:"2026-11-13"}}` with `swing.scanAsOf = "2026-11-06T14:15:15.469Z"` — predating
both fix PRs. `GET /api/market/swing/record?days=90` correctly shows negative deltas for every
closed SHORT/PUT (GOOG#71 -0.56, CG#25 -0.55, MSTR#33 -0.6, and 9 more), proving the read-time
re-sign pattern works everywhere it was applied.

## Fix

Added the identical `right === "P" ? -Math.abs(delta) : delta` re-sign — mirroring
`closed-plays.ts`/`roll-plan.ts`'s own exact pattern — to `discoverSwingFromPersisted`'s play
assembly, applied to every play's `contract` regardless of snapshot age.

## Blast radius

One file (`serving-lane.ts`), one function (`discoverSwingFromPersisted`). Fixes the delta sign
for every consumer of the WATCH/pre-entry swing lane that trusts `contract.delta`'s sign:
`play-brief.ts`'s narrated Greeks line, `PlayTerminal.tsx`'s red/neutral color coding for puts, and
any Largo directional-exposure math. Committed/live-quoted plays were already correctly signed
(via `live-plays.ts`'s own fix) and are unaffected by this change.
