# Admin 0DTE sim-board preview (`?sim=1`) loses the per-key wire precision the real member board was fixed to keep — gamma/vega/condor-width fields silently quantize to 2dp

> **kind:** `FINDING`

### Summary
`GET /api/market/zerodte/board` has two sibling response branches serving the identical
`ZeroDteBoardPayload` shape: the ADMIN-ONLY `?sim=1` preview branch and the real MEMBER branch.
The member branch calls `roundFloats(await getZeroDteBoardPayload(), 2, ZERODTE_BOARD_WIRE_DP)` —
the per-key precision map (`delta:4, theta:4, iv:4, gamma:6, vega:6, put_width_pct:4,
call_width_pct:4`) two prior PRs added specifically because the flat 2dp default silently
quantizes real sub-cent 0DTE greeks to `0.00` and collapses the iron-condor calibration-bucket
width (e.g. `0.00825`, the boundary between the 77%/92%/96% win-rate buckets in
`CONDOR_WINRATE_BY_WIDTH`) down to an indistinguishable `0.01`. The sim branch three lines above
called `roundFloats(await getSimBoardPayload())` with no third argument at all, so every one of
those seven fields fell back to the destructive flat-2dp default.

### Root cause
`ZERODTE_BOARD_WIRE_DP` is already imported into this exact file (used only at the member-path
call). Neither `getSimBoardPayload()`/`readSimBoardSnapshot()` nor the admin ingest route
(`src/app/api/admin/zerodte/sim/board/route.ts`, own comment: "written verbatim to the sim key")
round the posted frame upstream — so this route's own `roundFloats()` call was the only place
precision could ever be protected on the sim path, and it wasn't.

This is reachable, not theoretical: the documented admin tool for this feature,
`scripts/audit/zerodte-sim-feed.mjs` (CLAUDE.md: lets an admin "WATCH a simulated session play
through the REAL Night Hawk panel"), actively populates per-play `greeks` and ships PIN-condor
`condorGeom` through to the ledger row's `condor` field — exactly the field family this bug
affects, including via its documented `--replay=<file.json>` mode that can carry a real captured
production frame with real sub-cent precision.

### Evidence
- `route.ts:71` (sim branch): `roundFloats(await getSimBoardPayload())` — 2-arg, no override.
- `route.ts:87` (member branch, 3 lines later, same function): `roundFloats(await
  getZeroDteBoardPayload(), 2, ZERODTE_BOARD_WIRE_DP)`.
- The existing regression test for the keyDp fix (`route.test.ts`) mocks `isSimRequested` to
  always return `false`, so it never exercised the sim branch and could not have caught this.
- `src/lib/platform/zerodte-sim-board.test.ts` had a strict literal regex
  (`roundFloats(await getSimBoardPayload())`) that actively pinned the buggy 2-arg call as
  "correct" source text — a real guard-against-the-bug test, inverted.
- RED: 2 failures pre-fix (the updated regex assertion + a new behavioral test). GREEN: 16/16
  post-fix across `route.sim-precision.test.ts` (new), `route.test.ts`, and
  `zerodte-sim-board.test.ts`. `npx tsc --noEmit` clean.

### Fix
Mirrored the member-path call exactly: `roundFloats(await getSimBoardPayload(), 2,
ZERODTE_BOARD_WIRE_DP)`. No new import needed (already imported into this file).

Also hardened `zerodte-sim-board.test.ts`'s regex to assert the *specific* fixed override rather
than loosening to a tail wildcard (which would also pass with a different, possibly wrong, third
argument) — and added a new behavioral test file (`route.sim-precision.test.ts`, separate from
`route.test.ts` because `mock.module()` fixes each file's mocks at import time and the existing
file hardcodes the sim gate off) that drives the real route through the admin `?sim=1` path with
injected sub-cent greeks and a condor width at a live calibration boundary, asserting none of them
collapse.

### Blast radius
Single route, admin-only preview path (`?sim=1`). No change to the member path or to
`getSimBoardPayload`/the admin ingest route, both of which correctly do no rounding by design
(verbatim store).

| **Status** | FIXED — this PR. |
