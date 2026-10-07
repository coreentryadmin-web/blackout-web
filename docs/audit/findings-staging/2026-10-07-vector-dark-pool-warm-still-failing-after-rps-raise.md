## vector-dark-pool-warm still fails 90%+ of tickers per run even after the shared UW rate limiter's cluster-wide ceiling was doubled (PR #5579) — rotated to a half-universe batch — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | Vector dark-pool cache warm cron (`/api/cron/vector-dark-pool-warm`) + shared UW rate limiter |
| **Severity** | P1 performance/correctness — same severity class as the 2026-09-02/2026-09-15 prior findings this one re-measures |
| **Status** | FIXED (partial mitigation — see "What this does NOT do") |
| **File** | `src/app/api/cron/vector-dark-pool-warm/route.ts`, new `rotation.ts` |

### Background — why this was re-measured

A standing 5-engine live-monitor cycle found `vector-dark-pool-warm` failing ~93% of its UW pool
calls on every run for 3+ hours (`warmed=4 failed=51 elapsed=363632ms` at 13:36:38 UTC,
`warmed=2 failed=53 elapsed=378241ms` at 13:56:53 UTC, 2026-10-07), with a concurrent
`[db] transient query error: timeout exceeded when trying to connect` / `[ready] database ping
attempt failed` log pair suggesting a possible DB connection-pool angle.

### What was measured and ruled out

- **RDS connections**: `DatabaseConnections` on `blackout-production-postgres` held flat at
  19-21 across the entire incident window (11:35-14:34 UTC) — nowhere near the instance's real
  `max_connections` (~450 on `db.t4g.medium`, confirmed via `describe_db_parameters`) or the RDS
  Proxy's `MaxConnectionsPercent=90` backend budget (~405). The app's own internal
  `PGBOUNCER_DEFAULT_POOL_SIZE=20` self-check is a stale conservative assumption (web:
  `REPLICA_COUNT=8`×`PG_POOL_MAX=2`=16 + market-worker: 2 running×`PG_POOL_MAX=4`=8 = 24 > 20),
  genuinely worth tightening up separately, but is **not real contention at the RDS/Proxy layer**
  — both have enormous headroom versus this app's actual demand.
- **RDS instance health**: CPU ~9-11% the whole window, `CPUCreditBalance` pinned at its max
  (576, never drawn down), `ReadLatency`/`WriteLatency` ~0, `DiskQueueDepth` ~0, `FreeableMemory`
  steady ~1.9GB. No resource exhaustion at any point.
- **ElastiCache/Redis**: CPU ~5-6%, connections stable ~117-141, zero evictions — the Redis-backed
  global UW rate-limiter semaphore was not itself degraded/unreachable.
- **Conclusion**: the `[db] transient query error`/`[ready] database ping attempt failed` log pair
  seen alongside the 13:36 failure is most likely an independent, unrelated transient blip (RDS
  Proxy connection-borrow contention from some other momentary spike) rather than the cause of
  `vector-dark-pool-warm`'s UW failures — nothing in the DB/Proxy/Redis metrics correlates with
  the cron's measured failure pattern.
- **Cron schedule overlap**: confirmed real (per `[cron/*] background done` logs, 13:30-13:37 UTC:
  `vector-walls-warm`×2, `zerodte-warm`×3, `bie-full-state-snapshot`, all landing inside this one
  `vector-dark-pool-warm` run's ~6-minute window) — but this is a **UW-rate-limiter-queue**
  contention effect, not a DB-connection collision; see Root cause below.

### Root cause (confirmed via live `[api-queue-timing]` logs)

Pulled every `provider=unusual_whales endpoint=/api/darkpool/*` queue-timing log line in the
13:30-13:37 UTC window. Every logged HTTP call itself completed in well under a second
(`http_duration_ms` 39-1376ms, `status=200`) — **the UW API itself was fast and healthy the whole
time.** What grew across the run was `queue_wait_ms`, the time a request waited just to be
*admitted* into the shared rate limiter: 1934ms → 5108ms → 5590ms → 7328ms → 11702ms → 18274ms →
18730ms, approaching `DEFAULT_QUEUE_MAX_WAIT_MS`'s 20s ceiling (`queue-budget.ts`). Requests that
cross that ceiling are dropped as queue-timeouts before ever reaching UW — this is exactly how
`warmed=4 failed=51` happens with zero evidence of UW itself being slow or erroring.

This is the **same root cause** the 2026-09-02 and 2026-09-15 `FINDINGS.md` entries already
diagnosed (shared `GLOBAL_MAX_RPS` ceiling oversubscribed by aggregate cluster-wide UW demand —
live member traffic plus every concurrent background sweep), re-measured fresh and confirmed
**still present six days after PR #5579 (2026-10-01) doubled the cluster-wide ceiling itself**
(`UW_GLOBAL_MAX_RPS` 2→4). Verified that fix is actually live: the running ECS task's image tag
(`blackout-web:3d8c4fb3b...`) matches current `main`, which is well after #5579's merge commit.
Redis (the mechanism the global ceiling depends on) is healthy per the ElastiCache metrics above,
so the raised ceiling is genuinely in effect — and the cron is failing at essentially the same
~90%+ rate it failed at before the raise. Doubling the shared ceiling, by itself, was not enough:
aggregate platform-wide UW demand (not just this one cron) still saturates it.

### Fix

This cron's own `runUwPool` concurrency bound (3, from PR #3345) already caps how many of ITS OWN
requests sit in the shared admission queue at once — there is no further concurrency knob to turn
on this side. What was still fully in this cron's control: how much **total** work it asks the
shared queue to admit per run. `rotation.ts` adds a pure, Redis-cursor-persisted 2-way rotation —
each run now warms **half** the universe (`halfBatchSize`, rounds up) instead of the whole thing,
with the cursor advancing so the two halves alternate and the full universe is still covered every
2 runs (~20 minutes at this cron's ~10-minute cadence). Halving the per-run ticker count halves
this cron's own total admission-queue commitment, which — holding aggregate cluster congestion
constant — proportionally reduces how many of its own tail entrants can cross the 20s queue-wait
budget before being dropped.

**Why 2-way, not a larger split**: `warmVectorDarkPool`'s cache entries carry a 25-minute TTL
(`vector-dark-pool-cache.ts`). A 2-way rotation completes full coverage in ~20 minutes, comfortably
under that TTL; a 3-way rotation would take ~30 minutes — already past the TTL — trading the
queue-timeout failure mode for cache entries going empty between warms. 2-way is the largest split
that still respects the cache's own staleness bound.

**Why NOT raise `UW_GLOBAL_MAX_RPS` again or touch the shared limiter**: that's a cluster-wide
capacity decision affecting every UW consumer on the platform (live member traffic, Nighthawk,
SPX, Largo tool calls, every other background sweep) — exactly the kind of decision the 2026-09-15
finding reserved for the owning Vector lane rather than patching blind, and PR #5579 already made
that call once six days ago without resolving this. This fix is deliberately scoped to the one
cron's own per-run workload, which is fully this file's own responsibility.

### What this fix does NOT do

Does not guarantee a >90% success rate — it only halves this cron's own contribution to total
queue demand; if aggregate platform-wide UW demand is high enough, the smaller batch can still see
elevated queue waits, just proportionally less often. Does not address the underlying open capacity
question (is `UW_GLOBAL_MAX_RPS=4` still genuinely under UW's real account-level ceiling, and is
aggregate platform demand simply outgrowing it) — that remains the Vector lane's capacity decision
per the 2026-09-15 finding, now with fresh evidence that the 2→4 raise alone did not close the gap.
Does not touch the stale `PGBOUNCER_DEFAULT_POOL_SIZE=20` vs. real demand (24) mismatch noted above
under "What was measured and ruled out" — real RDS/Proxy headroom means this is not causing failures
today, but it's a correctness gap in the app's own self-check worth a separate, narrowly-scoped fix.

### Tests

`src/app/api/cron/vector-dark-pool-warm/rotation.test.ts` (8 new tests): `halfBatchSize` rounds up
correctly; batch selection picks the right half starting at a cursor; wraps around the end of the
list; two consecutive runs from a persisted cursor cover the full universe exactly once each;
out-of-range/negative cursors are normalized rather than throwing; empty universe and
batchSize>=length edge cases return safe, correct results.

`src/app/api/cron/vector-dark-pool-warm/route.test.ts` (+2 tests): the route imports and calls
`selectDarkPoolWarmBatch`/`halfBatchSize` (not a full-universe pool call), and persists/reads the
rotation cursor via the shared (Redis-backed) cache rather than per-process memory.

RED→GREEN proven via `git diff`/`git checkout --`: the 2 new route tests fail against the pre-fix
`route.ts` (2/6 fail, `runUwPool(allTickers...)`/no rotation import present) and all 6 pass with the
fix reapplied; all 8 new `rotation.test.ts` tests pass against the new pure module (no pre-fix
baseline needed — the module is new). `npx tsc --noEmit` clean. Full `npm test` (Node 20): run
alongside this PR — see PR description for the pass count (same pre-existing sandbox-only failures
as every other entry in this file, zero new failures from this change).
