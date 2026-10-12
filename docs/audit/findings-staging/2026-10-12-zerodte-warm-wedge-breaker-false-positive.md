## `zerodte-warm`'s wedge-breaker stole its own overlap lock from a slow-but-alive run — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Area** | Night Hawk 0DTE — cache warmer (`src/app/api/cron/zerodte-warm/route.ts`) |
| **Severity** | P2 (performance/correctness — self-inflicted overlap under ordinary RTH contention, not an outage) |

### Root cause

`zerodte-warm`'s cross-replica overlap lock (`OVERLAP_LOCK_KEY`, `sharedCacheSetNx`, 900s TTL) was
hardened on 2026-09-18 (#5213) with a "wedge-breaker": if the ZeroDTE scan heartbeat looked
`critical_stale` during cash RTH, the route would silently clear (`sharedCacheDel`) both the
overlap lock and the rerun cooldown, on the theory that the previous holder's background chain had
died (e.g. an ECS task recycled mid-flight) and would never release the lock itself.

`critical_stale` is a fixed 10-minute age threshold owned by the SHARED `play-engine-heartbeat.ts`
module — tuned for the admin dashboard's generic "is this engine's tick stale" display, not for
"is this specific run dead." Crucially, `recordZeroDteScanTick()` (`scan.ts:2536`) fires exactly
ONCE per `warmZeroDteBoard()` call, immediately after `scanZeroDteBoard()` fully returns — so the
heartbeat cannot advance at all while a scan is legitimately still in flight, however long it
takes. A single slow-but-alive run can therefore make its OWN heartbeat look `critical_stale`
before it ever finishes.

### Evidence

Measured live 2026-10-12, ordinary RTH contention (no outage, no genuinely wedged process):

```
19:20:47 [cron/cron-staleness-watchdog] self-heal re-warmed stale cron 'zerodte-warm' (status 202)
19:25:48 [cron/cron-staleness-watchdog] self-heal re-warmed stale cron 'zerodte-warm' (status 202)
19:31:07 [cron/zerodte-warm] background done — warmed=3 failed=0 elapsed=321783ms
19:31:33 [cron/zerodte-warm] background done — warmed=3 failed=0 elapsed=646035ms
```

Reconstructing start times from `finish − elapsed`: the 646035ms run started ~19:20:47 and was
still actively running when the 19:25:48 self-heal fired and was accepted (`status 202`, the
dispatched path — not the skip path, which would be a bare 200). The only way a second attempt is
accepted while the first is still in flight is if the overlap lock was cleared out from under it —
and 646035ms (10m46s) already exceeds the 10-minute `critical_stale` bar the wedge-breaker gates
on, while the run was actively succeeding, not dead. The wedge-breaker itself is therefore the most
likely mechanism that let a second, overlapping execution back in — the exact failure shape
`OVERLAP_LOCK_KEY` exists to prevent, defeated by its own safety valve. The steal path had zero
logging (confirmed: a CloudWatch grep for `steal`/`critical_stale` across the incident window
returned 0 hits), so this was invisible without reconstructing timestamps by hand.

### Fix

- Replaced the shared `heartbeat?.critical_stale` gate with a route-owned
  `WEDGE_BREAKER_MIN_AGE_MS = 12 * 60_000` (720s) compared directly against `heartbeat.age_ms` —
  comfortably above the worst real measured runtime (646035ms) while still recovering meaningfully
  faster than the lock's own 900s natural TTL for a genuinely dead process (the original #5213
  case, where nothing will ever tick again regardless of threshold).
- Added a `console.warn` when a steal actually fires, naming the heartbeat age — the path had no
  observability at all before this.
- Updated the existing wedge-breaker regression test to match the new condition, and added two new
  tests: one proving the new floor exceeds the measured worst-case runtime and stays below the
  lock's own TTL, and one proving the steal is now logged.

### Blast radius

One file (`route.ts`) + its test file. No change to `OVERLAP_LOCK_TTL_SEC`, the cooldown logic, or
any other cron's wedge-breaker (none of the other dispatch-table crons have one).

### Test

`src/app/api/cron/zerodte-warm/route.test.ts` — RED→GREEN proven via `git stash` (3/13 fail
pre-fix on the new/updated assertions, 13/13 pass post-fix). `tsc --noEmit` clean. Collateral:
`src/lib/zerodte/*.test.ts` + `src/lib/play-engine-heartbeat.test.ts` — 1477/1478 pass, 1
pre-existing unrelated skip, 0 failures.
