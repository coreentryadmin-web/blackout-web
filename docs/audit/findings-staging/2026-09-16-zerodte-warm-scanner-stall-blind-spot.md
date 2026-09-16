> **kind:** FINDING

## 0DTE scanner (`warmZeroDteBoard`/`persistZeroDteScan`) silently stalled ~35min live today — nothing in the health pipeline could have caught it — FIXED

| | |
|---|---|
| **Status** | FIXED (this PR) — wired the existing-but-unread scanner heartbeat into cron health, and corrected the writer-target-freshness probe that was masking exactly this failure. |
| **Lane** | Night Hawk 0DTE (Ask 0DTE deep-dive, 2026-09-16, operator directive: "only focus on 0dte from today... fix up all shit and make it the best system") |
| **Severity** | P1 — the discovery/commit ledger (the path that actually opens real positions) can go dark for tens of minutes with zero alerting, and this is directly the shape of the operator's original complaint ("the best winners are always on watch... something is wrong"). |
| **Files** | `src/lib/admin-cron-health.ts`, `src/lib/cron-writer-target-fresh.ts` (+ their `*.test.ts`) |

### Root cause

Investigating why LITE (score 80 at one point) and other setups never got promoted today led to a much bigger finding than a single ticker. Pulling LITE's and HOOD's full event timeline off `GET /api/admin/zerodte/funnel?date=2026-09-16` (the route built earlier this session, PR #5079) showed **zero discovery-events for ANY ticker between 15:29:58 and 16:10:52 UTC (11:29–12:10 ET) — a 41-minute total silence**, confirmed system-wide via a full-day gap scan (`events strictly inside 15:30-16:10 window: 0`).

Cross-referencing live CloudWatch Logs (`/ecs/blackout-production`) pinned the mechanism precisely:
- `[zerodte-scan]` log lines (the pure computation inside `scanZeroDteBoard()`) kept firing every ~1–5 min throughout the "gap" — the scan itself, and the **live board members see, was never down**. Candidate pool even grew (rail-mix total 165→188) during the window.
- But `[cron/zerodte-warm] background done` — logged only once `warmZeroDteBoard()`'s persist chain (`persistZeroDteScan` → ledger write → `zerodte_discovery_events`) actually completes — appeared only **twice** in this whole window: at 15:29:57 (a 282s run) and 16:11:00 (a 368s run). In between, `rth-warm-leader` dispatched the cron's HTTP route roughly every 1–5 min and every call returned `ok` fast — but the heavy background chain those calls kick off never logged a single completion (`background done`) or rejection (`background warm REJECTED`) for ~35 straight minutes.
- This is **not a new failure mode** — `src/app/api/cron/zerodte-warm/route.ts`'s own code comment already documents an *identical* incident from 2026-09-08 ("only 2 real `[cron/zerodte-warm] background done` completions in an 8-hour window against ~36 route 'ok' responses") and describes the fix already applied (moving off `after()` to a bare fire-and-forget dispatch as the "PRIMARY" path). **That fix did not hold** — the exact same symptom recurred today, over a week later, live.

### Why nothing caught it

Two independent gaps in the health/alerting pipeline, both traced and both fixed here:

1. **`cron_job_runs` (the handshake `admin-cron-health.ts` normally checks) can never go stale for this cron**, because `logCronRun("zerodte-warm", accepted)` fires on the route's FAST synchronous path — auth, the cooldown/lock gate, and the cheap `warmGridEarnings()` warm — all of which complete in milliseconds regardless of whether the heavy background chain ever finishes. So by the time the handshake is checked, it always looks "on schedule."
2. **The one signal that WOULD catch this already existed and was completely unread.** `warmZeroDteBoard()` calls `recordZeroDteScanTick("cron")` (scan.ts:2442, `play-engine-heartbeat.ts`) right after `scanZeroDteBoard()` returns — its own code comment says this exists specifically because "a silent stall here is the same class of blind spot the SPX play engine heartbeat was built to catch." But unlike the SPX play-engine heartbeat (which IS cross-checked against `spx-evaluate`'s cron health in `admin-cron-health.ts`), `getZeroDteScanHeartbeat()`/`loadZeroDteScanHeartbeat()` had **zero callers outside `play-engine-heartbeat.ts` itself** — grep confirmed no route, no admin dashboard, nothing ever read it. Write-only instrumentation.
3. **Worse: even a naive staleness check would have been actively suppressed.** `admin-cron-health.ts`'s `TARGET_FRESH_OVERRIDE_KEYS` includes `"zerodte-warm"` — when the handshake looks stale, it re-checks a "real target" via `probeWriterTargetFresh` and flips back to healthy if that target is fresh. But the `"zerodte-warm"` case in `cron-writer-target-fresh.ts` probed the **earnings-match cache** (`ZERODTE_EARNINGS_KEY`) — the SAME fast synchronous sub-task from point 1, unrelated to whether the scanner/persist chain is alive. During today's real 35-minute stall, that cache stayed fresh the entire time (it's warmed on every fast handshake), so this override would have actively reported "target fresh" and suppressed any staleness flag, had one ever fired.

### Fix

- `src/lib/admin-cron-health.ts`: added a `zerodte-warm` heartbeat cross-check mirroring the existing `spx-evaluate` pattern, reading `loadZeroDteScanHeartbeat()` directly. Deliberately does **not** gate on the `cron_job_runs` handshake also looking stale first (the way `spx-evaluate`'s does via its `cronStale` condition) — that handshake is the known-unreliable signal here per root cause #1, so the scan heartbeat's own `stale`/`critical_stale` (5min/10min age thresholds, already defined in `play-engine-heartbeat.ts`) is authoritative in-window.
- `src/lib/cron-writer-target-fresh.ts`: changed the `"zerodte-warm"` case to probe the same scan heartbeat instead of the earnings cache, so `TARGET_FRESH_OVERRIDE_KEYS` can no longer contradict the new cross-check above with a stale proxy.
- Regression tests added to both files' `*.test.ts` (source-level assertions, matching this file's existing testing convention for probes that need dynamic imports) plus full `play-engine-heartbeat.test.ts` coverage (pre-existing, unaffected) — `npm test` full suite: 0 failures.

### What this does NOT fix

This makes the stall **detectable** (an admin dashboard status flip to `stale`/`warning` within 5–10 minutes of a real recurrence, instead of silent for 35+ minutes). It does **not** fix the underlying cause of why `warmZeroDteBoard()`'s background chain stops completing — that root cause is still unknown (candidates worth checking on the next live recurrence, now that it will be visible in real time: Node event-loop starvation from the heavy synchronous GEX full-chain-escalation work competing with the background promise's continuations; Postgres connection-pool contention during the same window; or something specific to `runWithBackgroundUwSweep`'s concurrency reservation). Per the standing escalation policy, guessing at that mechanism without live evidence from a caught-in-the-act recurrence would risk a wrong fix; this PR makes the NEXT recurrence catchable and diagnosable instead.

### Evidence

```
raw_events (GET /api/admin/zerodte/funnel?date=2026-09-16): 1652 events total
events strictly inside 15:30-16:10 window: 0

CloudWatch /ecs/blackout-production, "zerodte-warm" filter:
15:25:16  [rth-warm-leader] backup warm 'zerodte-warm' ok (1441ms)
15:26:35  [rth-warm-leader] backup warm 'zerodte-warm' ok (6ms)
15:29:57  [cron/zerodte-warm] background done — warmed=3 failed=0 elapsed=282251ms
15:30:37  [rth-warm-leader] backup warm 'zerodte-warm' ok (2094ms)
...(11 more "backup warm ok" dispatches, none producing a completion log)...
16:10:10  [rth-warm-leader] backup warm 'zerodte-warm' ok (780ms)
16:11:00  [cron/zerodte-warm] background done — warmed=3 failed=0 elapsed=368355ms

"[zerodte-scan]" filter, same window (proves the SCAN itself, not persistence, kept running):
15:33:38 / 15:38:29 / 15:39:10 / 15:46:17 / 15:47:54 / 15:48:36 / 15:48:37 / 15:51:50 / 15:54:24
  discovery rail mix total=165→188 (growing candidate pool throughout)
```

### Next-session market-open validation

Logged in `docs/audit/MARKET-OPEN-VALIDATION.md` — check the admin cron-health dashboard for `zerodte-warm` during RTH; a `stale`/`warning` status with label `"Scanner stale · last scan tick Nm ago"` proves the fix surfaces a real recurrence, and its `meta.zerodte_scan_heartbeat` field should carry a real, non-null `last_tick_at`.
