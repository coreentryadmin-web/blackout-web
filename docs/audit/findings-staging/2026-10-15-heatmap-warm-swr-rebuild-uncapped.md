> **kind:** FINDING

## `fetchGexHeatmap`'s stale-while-revalidate background rebuild had no concurrency cap — 100+ full-chain escalations in one `heatmap-warm` pass, time-correlated with a 79.5s ALB latency spike — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P1 — measured ALB TargetResponseTime 79.5s Max / 6.43s AVERAGE (a high average means many requests were slow, not one outlier) |
| **File** | `src/lib/providers/polygon-options-gex.ts` (`tryStaleWhileRevalidateHeatmap`, new `shouldStartHeatmapBackgroundRebuild`/`heatmapMaxConcurrentBuilds`) |
| **Found by** | Standing performance/latency audit mandate — investigation of a live 2026-10-15 ALB spike |

### Root cause

Two independent, correctly-measured threshold tunings both already shipped 2026-10-08 for
`heatmap-warm`: `RTH_WRITER_HEAL_AFTER_MIN["heatmap-warm"]` was raised from a nonsensical 20s to the
job's own measured p90 runtime (81s), and `heatmap-warm/route.ts`'s bulk ticker loop was migrated
from a bare unbounded `Promise.allSettled` to `runPolygonPool(8)`. Both were real fixes for the
problem they targeted (the cron's own re-dispatch churn, and its own ticker loop's fan-out) — but
neither covers the branch this incident actually hit.

`fetchGexHeatmap()` (shared by every caller: `heatmap-warm`, the Vector universe build, desk
loaders, member GET requests) serves a per-ticker matrix cached with a 5s TTL
(`GEX_HEATMAP_CACHE_SEC ?? 5`) and a 90s max-stale ceiling (`gexHeatmapMaxStaleMs`). When an
entry's age falls inside `[5s, 90s)`, `tryStaleWhileRevalidateHeatmap` returns the stale payload
**immediately** and kicks off a **detached** background rebuild
(`buildGexHeatmapUncached`, fire-and-forget via `void build.catch(...)`) to refresh it. That detached
rebuild is NOT the branch `runPolygonPool(8)` bounds — the pool only bounds the `await
fetchGexHeatmap(t)` call in `heatmap-warm`'s loop, which resolves almost instantly here (stale
payload served), freeing the pool slot immediately while the real rebuild keeps running
un-pooled. It is also not covered by the cross-replica `sharedCacheSetNx` build lock used by the
fully-cold branch further down in the same function — that lock is only acquired on the path below
this one.

`heatmap-warm`'s real full-sweep cadence is 46–209s measured (p50=46.5s/p90=81.1s/p99=181.1s/
max=209.2s) — far longer than the 5s TTL but, for most tickers most of the time, still under the
90s max-stale ceiling. So on nearly every single pass, most of the shared ~100-ticker universe
lands in exactly this uncapped branch, and each ticker independently fires its own detached
Polygon rebuild with zero cross-ticker throttling. When a rebuild's banded strike pull comes back
thin (`shouldEscalateToFullChain`, <45 in-band strikes), it re-fetches the FULL unfiltered chain —
the escalation already named in `CLAUDE.md` as the confirmed trigger for the repo's recurring
~40-44s ALB tail-latency spikes, here firing through a third, previously uncapped entry point (the
other two — Vector `/universe`'s own fan-out and `ensureWebBootWarm()`'s unconditional board build
— were already fixed, the latter also on 2026-10-08).

### Evidence

Live, 2026-10-15: `rth-warm-leader` backup-dispatched `heatmap-warm` at 11:00:23 UTC (judged
overdue past its 81s heal threshold); that single dispatch took 67,775ms. Starting immediately
after and continuing ~4 minutes (11:00:55–11:04:30), CloudWatch Logs Insights on
`/ecs/blackout-production` showed 100+ `[polygon-gex] full-chain escalation ADOPTED` lines across
dozens of unrelated tickers (CBRS, CRWV, PL, NET, WGS, SAP, INTC, TXN, LRCX, NFLX, T, PM, NEE, RTX,
NOC, MCO, IBM, ELV, DHR, CSX, CME, ABT, MMM, COF, GM, USB, and more). `ecs.describe_services`
confirmed no new deployment/task-start event was in progress at 10:58:58 (8/8 steady state, no
pending tasks), ruling out a fresh-task boot-warm burst as the cause. AWS/ApplicationELB
TargetResponseTime measured 79.5s Max / 6.43s AVERAGE at 11:01 UTC — a high average means many
concurrent requests were slow, consistent with an uncapped fan-out saturating a replica's event
loop/Polygon rate budget, not one random outlier.

Regression test (`polygon-options-gex.test.ts`), RED→GREEN verified via `git stash` isolation on
`src/lib/providers/polygon-options-gex.ts` alone: pre-fix, the new
`shouldStartHeatmapBackgroundRebuild` export does not exist (3 test failures — import + its two
unit tests + the wiring-proof source-text test). Post-fix, all pass (73/73 in the file).

### Fix

Added `shouldStartHeatmapBackgroundRebuild(inflightCount, cap)` — a pure, unit-tested decision
function — and gated the detached-rebuild kickoff in `tryStaleWhileRevalidateHeatmap` on it,
reading the existing `heatmapInflight.size` (already a live, accurate, process-wide count of every
heatmap build in flight — both this branch and the cold-build branch insert into the same map, so
no new tracking structure was needed). Default cap 8 (matches `runPolygonPool`'s
`POOL_MAX_CONCURRENCY`), env-overridable via `GEX_HEATMAP_MAX_CONCURRENT_BUILDS`.

Capping here is safe because the stale-while-revalidate contract is "never block the caller, serve
what we have" either way: when the cap is hit, the branch simply skips starting a new rebuild and
serves the same still-under-90s stale data for a little longer — the next caller for that ticker
(this cron's own next tick, at most ~60-81s away, or any other reader) retries once a slot frees up.
Nothing a normal (non-storm) caller does would ever approach a cap of 8 concurrent rebuilds, so
ordinary single-ticker member traffic is unaffected; only a mass-simultaneous-staleness event (a
cold/overdue `heatmap-warm` sweep, or several callers racing the same stale universe at once) is
throttled, spreading the real Polygon/CPU cost over wall-clock time instead of letting it fan out
unbounded in one burst.

### Blast radius

Fixed at the shared layer (`fetchGexHeatmap`/`tryStaleWhileRevalidateHeatmap`), not inside
`heatmap-warm`'s own route — every caller of `fetchGexHeatmap` benefits (Vector universe build,
desk loaders, member GET requests), not just this one cron. No caller's observable contract
changes: every path still returns promptly (stale-serve or a capped/bounded rebuild), never blocks
longer than before. Narrow, single-function change; no gate, schedule, or threshold elsewhere was
touched — the two 2026-10-08 fixes in this neighborhood (heal-threshold raise, `runPolygonPool` on
`heatmap-warm`'s loop) are unaffected and remain correct for the problems they targeted.
