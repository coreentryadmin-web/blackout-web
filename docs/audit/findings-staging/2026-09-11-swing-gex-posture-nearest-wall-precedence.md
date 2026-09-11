> **kind:** FINDING

## Swing "GEX posture" nearest-wall used raw GEX-matrix walls while "Levels on chart" already preferred a live Vector wall — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 (cross-section factual contradiction inside one Ask Largo envelope) |
| **Area** | Night Hawk Swings / Ask Largo play-brief |
| **Found by** | Claude, PR #4076 collaboration thread (2026-09-11 cycle), live MSTR:33 |

### Root cause

`play-brief-intel.ts`'s `chartLevelsSection` ("Levels on chart") already prefers a live Vector
ladder call/put wall over the raw GEX-matrix `call_wall`/`put_wall` — fixed for GEX king strike on
2026-09-09 for exactly this same reason (comment in-file names the live AAPL:36 defect it
corrected). `gexPostureSection` ("GEX posture") never got the same treatment: its "Nearest wall"
line read `ecosystem.gex_positioning.nearest_wall` directly — a value `nearestWallFromLevels`
computes ONCE, upstream, from the raw GEX-matrix `call_wall`/`put_wall` only, with no Vector
input at all.

Live evidence (MSTR:33, `GET /api/market/swing/play-brief?playId=SWING:MSTR&ticker=MSTR&positionId=33`,
spot 127.25):
- **Levels on chart:** `Put wall (GEX): 125.00` (Vector ladder put wall, preferred)
- **GEX posture:** `Nearest wall: 120.00 (support, -7.3 pts from spot 127.25)` (raw GEX-matrix
  put_wall)

Both numbers claim to describe the same underlying reality — the nearest dealer support level —
in the same envelope, for the same spot, and disagree. Worse than a stale-vs-live split: 125 is
also numerically CLOSER to spot (127.25) than 120, so the un-reconciled "Nearest wall" line wasn't
just reading a different source, it was reporting the less-true "nearest" by the matrix's own raw
levels once Vector's fresher wall is available.

### Fix

Extracted the existing Vector-first/GEX-matrix-fallback wall resolution already living inside
`chartLevelsSection` into a shared `preferredGexWalls(ctx)` helper (same staleness gating:
Vector-stale and GEX-matrix-stale each independently suppress that source, matching the existing
Largo C2 discipline). `chartLevelsSection` now calls the shared helper instead of duplicating the
logic inline. `gexPostureSection` now calls the same helper and recomputes "Nearest wall" via the
already-existing shared `nearestWallFromLevels` (`src/lib/providers/gex-nearest-wall.ts` — built
2026-09-08 specifically so call sites needing this exact logic don't re-derive "nearest" a second
way) instead of reading the raw matrix-only field. Both sections in one brief now agree on which
wall is closer, and on its value.

### Blast radius

Only `gexPostureSection`'s "Nearest wall" line was reading the raw field directly; no other
section in `play-brief-intel.ts` referenced `gex.nearest_wall`. `tradeManagerNarrativeSection`
(`play-brief-narrative.ts`, the dealer-posture narrative from #4084) does not use `nearest_wall`
at all, so it was not affected.

### Evidence

- `npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief-intel.test.ts` —
  RED→GREEN: new test failed pre-fix (`actual: Nearest wall: **120.00**...`, asserting on 125),
  passed post-fix; full file 81/81 pass, no regressions.
- `npx tsc --noEmit -p .` — clean.
- `npm test` (full suite, Node 20) — clean, no regressions (see PR for run confirmation).
