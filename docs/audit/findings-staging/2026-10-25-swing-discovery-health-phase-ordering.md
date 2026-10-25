> **kind:** FINDING

## Night Hawk Swings — discovery-cron-health's "last ended phase" picked the wrong phase outside array order — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Surface** | `src/lib/swing/discovery-cron-health.ts` (`swingDiscoveryPhasesEndedBefore`, `probeSwingDiscoveryServingSnapshot`) |
| **Severity** | P2 (health-check/monitoring surface, wired into `cron-writer-target-fresh.ts`) |

### Root cause

`scan-cadence.ts`'s own header is explicit that `SWING_SCAN_PHASES`' array order is **not**
chronological: POST_CLOSE is deliberately listed first "so the stable render/iteration order puts
it at the head. Correctness does NOT depend on this order ... only the render/first-of order
does." The actual chronological order by `startMin` is PRE_OPEN → MIDDAY → POWER_HOUR →
POST_CLOSE → OVERNIGHT.

`swingDiscoveryPhasesEndedBefore` returned `SWING_SCAN_PHASES.filter(...).map(...)` in that same
array order. Its only caller, `probeSwingDiscoveryServingSnapshot`, takes
`endedPhases[endedPhases.length - 1]` and trusts it to be the phase that ended **most recently** —
exactly the kind of "first-of/last-of" use `scan-cadence.ts`'s own header warns depends on real
chronological order.

### Evidence

At 21:00 ET (after POST_CLOSE ends at 20:00, before OVERNIGHT ends at 24:00):

```js
swingDiscoveryPhasesEndedBefore(now, "2026-10-23")
// pre-fix:  ["POST_CLOSE", "PRE_OPEN", "MIDDAY", "POWER_HOUR"]  (array order; last = POWER_HOUR)
// post-fix: ["PRE_OPEN", "MIDDAY", "POWER_HOUR", "POST_CLOSE"]  (ended order; last = POST_CLOSE)
```

`POWER_HOUR` ended at 16:00; `POST_CLOSE` — the file's own "PRIMARY... cleanest read of the day's
accumulation" phase — ended later, at 20:00. Picking `POWER_HOUR` as "last ended" floors the
freshness check at its 15:00 start instead of POST_CLOSE's 16:15 start.

Concrete downstream effect, `probeSwingDiscoveryServingSnapshot` at 21:00 ET with a snapshot
timestamped 15:05 ET (predating POST_CLOSE's own start entirely, so it cannot possibly reflect
POST_CLOSE having run):

```
Pre-fix:  { fresh: true,  detail: "serving snapshot 2026-10-23 · 355m old · phases ended: POST_CLOSE,PRE_OPEN,MIDDAY,POWER_HOUR" }
Post-fix: { fresh: false, ... }
```

### Blast radius

`swingDiscoveryPhasesEndedBefore` has one caller (`probeSwingDiscoveryServingSnapshot`, same
file), which is itself consumed by `cron-writer-target-fresh.ts` — a live monitoring/health-check
surface whose stated purpose (per this file's own header) is to "suppress handshake-only
staleness... must not page when `swing:serving:latest:v1` still reflects today's session." The bug
runs in the opposite direction from a false page: it is a false "fresh," during the daily
20:00–24:00 ET window, that could mask a serving snapshot that never actually reflected the
POST_CLOSE scan — exactly the phase this whole discovery lane is built around.

### Fix rationale

Sort the filtered phases by `endMin` ascending before returning, so both this function's own
`.join(",")` display order and the caller's `[length-1]` "most recently ended" read are correct.
Scoped entirely to this one function — `resolveScanPhase`/`decideSwingScan` (`scan-cadence.ts`)
resolve by range containment, not array position, and were never affected.

### Tests

Added two cases to `discovery-cron-health.test.ts`: a direct case confirming
`swingDiscoveryPhasesEndedBefore` returns ended-order (not array order) at 21:00 ET, and an
integration case confirming `probeSwingDiscoveryServingSnapshot` correctly reads `fresh: false` for
a snapshot predating POST_CLOSE's start when checked after POST_CLOSE has ended. RED→GREEN
confirmed: reverting only the source fix (keeping the new tests) fails 2/6 exactly as expected;
reapplying passes 6/6.

- `npx tsx --experimental-test-module-mocks --test src/lib/swing/discovery-cron-health.test.ts` — 6/6 pass
- `npx tsc --noEmit` — clean
- Full `npm test` (Node 20) run alongside this PR
