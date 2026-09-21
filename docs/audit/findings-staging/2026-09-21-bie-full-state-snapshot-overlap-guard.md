> **kind:** FINDING

## `bie-full-state-snapshot` cron had no cross-replica overlap guard — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 (tail-latency / performance) |
| **Found** | 2026-09-21, standing performance/latency audit mandate |

### Evidence

Deployed EventBridge rule (confirmed live via `boto3` `describe_rule`):

```
blackout-production-bie-full-state-snapshot -> cron(*/5 11-21 ? * MON-FRI *) ENABLED
```

Live CloudWatch Logs (`/ecs/blackout-production`, `elapsed=` grep, 2026-09-21 11:37-14:37 UTC RTH
window):

```
[cron/bie-full-state-snapshot] background done — ... elapsed=407874ms
[cron/bie-full-state-snapshot] background done — ... elapsed=355974ms
```

Both real runs exceed the cron's own 300-second (5-minute) schedule interval — 407.9s and 356.0s
respectively. `src/app/api/cron/bie-full-state-snapshot/route.ts` had no overlap guard at all: the
next scheduled EventBridge fire starts `buildBieFullState()` a second time while the previous run
is still in flight. `buildBieFullState()` fans out across the same cluster-wide Polygon/UW rate
limiters (`GLOBAL_MAX_RPS`) that real member requests and every other Vector/0DTE cron already
depend on — the exact overlap shape `vector-pick-sweep`'s own guard (fixed 2026-09-02/03, see that
route's own header comment) was built to prevent. Same window's ALB `TargetResponseTime` showed
p99 in the tens of seconds (up to ~48s) with p50 staying under 300ms — a tail-latency signature
consistent with a small number of background jobs saturating the shared rate limiters, not a
fleet-capacity problem.

### Root cause

`route.ts`'s `GET` handler dispatched `runBieFullStateSnapshot()` unconditionally in the background
(`after(dispatchSnapshot)`) with no idempotent-skip lock — unlike its sibling crons
(`vector-pick-sweep`, `zerodte-warm`, `swing-discovery`, `banger-discovery`, `thermal-discord`,
`darkpool-discord`, `data-correctness`, `helix-discord-digest`) which all already use the
`sharedCacheSetNx` cross-replica overlap-lock pattern for this exact problem shape.

### Fix

Added the same `sharedCacheSetNx`/`sharedCacheDel` overlap-lock pattern as `vector-pick-sweep`:
- `OVERLAP_LOCK_KEY = "bie-full-state-snapshot:running"`, `OVERLAP_LOCK_TTL_SEC = 900` (15 min,
  matching the cron's own `stale_after_min: 15` in `cron-registry.ts`, which was already correctly
  set — no change needed there).
- Acquire before dispatch; a lost race returns `{ skipped: true, reason: "previous snapshot still
  in flight (idempotent skip)" }` instead of running a second snapshot.
- Fails OPEN on a Redis error (`.catch(() => true)`) — a missed overlap guard is safer than a
  wedged cron.
- Lock released in a `finally` block so a thrown snapshot still frees the next run.

TTL of 900s gives real margin above the worst observed 408s runtime.

### Blast radius

Scoped to `src/app/api/cron/bie-full-state-snapshot/route.ts`. No other call site invokes
`buildBieFullState()` directly (grepped) — this is the cron's only trigger path. `vector-full-state-snapshot`
(same 5-min schedule) and `vector-dark-pool-warm` (10-min schedule) were also checked against their
own measured elapsed times in the same CloudWatch window and are NOT at risk (max observed 197s vs
300s schedule; max observed 383s vs 600s schedule respectively) — left untouched per the standing
mandate's "do not add a lock to a cron that doesn't need one" discipline.

### Evidence (RED→GREEN)

New test file `src/app/api/cron/bie-full-state-snapshot/route.test.ts` (7 tests), mirroring
`vector-pick-sweep/route.test.ts`'s existing pattern:
- RED (pre-fix, source stashed via `git stash`): `7 tests, 0 pass, 7 fail` — every new test failed.
- GREEN (post-fix): `7/7` pass.
- `npx tsc --noEmit -p .` clean.
- Full repo suite (`npm test`, Node 20): run alongside this cycle's merge validation, no collateral
  breakage in this file's area.

Not a trading-behaviour change — no gate, score, rail, exit rule or grading path touched, only
adds an idempotent cross-replica skip to a background cache-warming cron.
