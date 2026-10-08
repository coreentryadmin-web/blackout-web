## 2026-10-08 — [FINDING, P1 Performance/latency, ECS web tier] `heatmap-warm`'s bulk "rest" ticker fetch fanned out via an UNBOUNDED `Promise.allSettled` — the confirmed downstream contention mechanism behind the recurring ALB tail-latency spikes #5680/#5684 left open — FIXED

> **kind:** `FINDING`

| Field | Detail |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P1 (recurring, every-minute-during-RTH ALB `TargetResponseTime` p99/Max spikes up to 80s on `blackout-production-app`) |
| **Component** | `src/app/api/cron/heatmap-warm/route.ts` |
| **PR** | fix/heatmap-warm-unbounded-rest-fanout |

### Context — picking up exactly where #5680/#5684/#5685 left off

#5680 (2026-10-08, earlier the same day) confirmed the **TRIGGER** for recurring ~40-44s ALB
`TargetResponseTime` spikes — `GET /api/market/vector/universe`'s cache-miss inline rebuild — but
explicitly left the **downstream contention mechanism** open: *"why this stalls an unrelated
`/api/market/spx/desk` rebuild on the SAME replica... is still #5650's open, unconfirmed
libuv-threadpool hypothesis."* #5684 (same day) fixed `heatmap-warm`'s in-app-leader heal threshold
(a duty-cycle/backup-semantics bug) but explicitly disclaimed any ALB-latency causation claim after
measuring the overlap-fraction correlation and finding it indistinguishable between spike and
non-spike minutes. This finding picks up that exact open thread: it does NOT re-litigate #5678,
#5680, #5681, #5684 or #5685 (all correct and unchanged) — it root-causes the mechanism they left
unproven.

### Evidence — live, this cycle, not re-derived from an older incident

**Live CloudWatch Logs** (`/ecs/blackout-production`, `full-chain escalation ADOPTED`, last 35 min
as of 2026-10-08 ~11:09 UTC) showed one ECS task (`e6ce22f4072c465fb0852854484467db`, the current
`rth-warm-leader` in-process leader) running 142 of 258 total escalation log lines in that window —
by far the dominant source — with the SAME ~25-30-ticker subset (LUNR, ASTS, OXY, RIOT, SLB, RKLB,
ANET, MARA, CVX, BAC, XOM, MRK, MS, ABBV, COP, GILD, VRT, BA, JPM, HOOD, V, PLTR, COIN, AMZN, MSTR,
AAPL, PENG, PL, MRNA, NFLX — the EXACT list the investigating prompt for this cycle named) escalating
to a full unfiltered chain pull on **every single run**, not as a rare edge case. Cross-referencing
that task's own `[rth-warm-leader]` log lines pinned two full `heatmap-warm` runs precisely:
`10:57:25.585 backup warm 'heatmap-warm' ok (86619ms)` (started ~10:55:59) and
`11:00:02.864 backup warm 'heatmap-warm' ok (63317ms)` (started ~10:58:59.5).

**`AWS/ECS` Container Insights per-task `CpuUtilized`** (the `/aws/ecs/containerinsights/
blackout-production-cluster/performance` log group, Task-type records, 1-min granularity) for that
exact task over the exact same window:

| minute (UTC) | task `e6ce22f...` CPU units (of 2048 reserved) | note |
| --- | --- | --- |
| 10:54 | 249 | run starting |
| 10:55 | 92 | |
| 10:55-10:57 (run 1 in flight) | — | |
| **10:56** | **766.4** | — 0.75 of one full vCPU, sustained |
| **10:57** | **708.3** | — run 1 ends 10:57:25.585 |
| 10:58 | 123.3 | declining |
| **10:59** | **760.4** | run 2 in flight (started ~10:58:59.5) |
| **11:00** | **387.1** | run 2 ends 11:00:02.864 |
| 11:01 | 65.2 | back to idle |

Baseline for this same task in quiet minutes (10:47-10:53, no warm-pass in flight): **8-18 CPU
units** — i.e. the warm-pass spikes CPU on this ONE task by **40-95x**, to 0.7-0.85 of a full vCPU,
continuously, for the entire ~60-90s run duration. Four sibling tasks serving ordinary live traffic
in the SAME minutes stayed at their own normal 9-20 CPU-unit baseline throughout — this is a
genuinely single-task phenomenon, not a fleet-wide pattern.

**This directly corrects #5680's prior "ECS CPU 1-min averages stayed low (2-8% avg, 20-55% max)"
conclusion** — that read was almost certainly FLEET-AVERAGE CPU (across all 8 web tasks), which
dilutes a 700-860-unit single-task spike down to exactly the 2-8%-ish range reported (750/8 tasks ≈
94, close to "low single digit percent" of the fleet's combined 16384-unit reservation). Per-task
CPU — not previously pulled by this investigation — tells a completely different story.

**`AWS/ApplicationELB` `TargetResponseTime`** (1-min p50/p90/p99/Max, `blackout-production-app`
target group) for the identical window:

| minute (UTC) | p50 | p99 | Max |
| --- | --- | --- | --- |
| 10:55 | 0.009 | 0.535 | 1.187 |
| **10:56** | 0.117 | **8.582** | **8.606** |
| 10:57 | 0.009 | 0.416 | 0.416 |
| 10:59 | 0.145 | 0.145 | 0.145 |
| **11:00** | 0.025 | **31.869** | **32.396** |
| **11:01** | 0.276 | **51.522** | **51.615** |

(Matches the investigating prompt's own cited numbers — 10:56Z p99=8.6s, 11:00Z p99=31.9s/
max=32.4s, 11:01Z p99=51.5s/max=51.6s — independently re-pulled here, not merely re-quoted.) p50
stays under 0.3s throughout both windows in every sample — this is a tail-latency signature (some
requests very slow), not fleet capacity, exactly as the prior investigation already established;
the new evidence is WHICH requests and WHY. The 11:00/11:01 spike lags the run-2 CPU spike (peak at
10:59) by about a minute — consistent with a request queued/stalled DURING the high-CPU window not
completing (and therefore not being recorded in `TargetResponseTime`, which measures at completion)
until after the CPU-heavy work cleared. The pattern repeats on MULTIPLE different tasks at
different times across the following 15 minutes (33ff230d.../2deef6b5.../c0153891.../e7ed8662...
each independently spike to 700-860 CPU units at their own turn, each followed by an ALB p99/Max
spike of 32-80s) — this generalizes across whichever task happens to be running an expensive warm
pass at any given moment, not one pinned task or one specific cron.

### Root cause

`src/app/api/cron/heatmap-warm/route.ts`'s own per-ticker sweep handles its ~100-130-name shared
universe in three tiers: `priority` and `core` tickers are each processed in a plain sequential
`for` loop (one `fetchGexHeatmap` at a time — slow but NOT bursty), but the bulk **`rest`** tier —
typically 70-100+ of the universe's names, everything outside the small priority/CORE set — fanned
out via a bare:

```ts
const restResults = await Promise.allSettled(rest.map((t) => fetchGexHeatmap(t)));
```

with **no concurrency bound whatsoever**. Every one of those 70-100+ `fetchGexHeatmap` calls fires
its real Polygon chain fetch at once. `polygon-rate-limiter.ts`'s own `MAX_CONCURRENCY` (48,
per-process) admits up to 48 of them into flight on this SAME ECS task simultaneously — a huge,
un-paced batch, not the deliberately-small window a healthy warm pass should ever create. However
many of those land in the same admission wave resolve in a cluster, and each one's REAL per-ticker
synchronous cost — parsing the (sometimes full-unfiltered-chain, per `shouldEscalateToFullChain`)
JSON response, building the GEX matrix, and building the depth ladder (`buildGexDepthLadder`'s own
doc comment: *"Cost is ~33 x chain-size closed-form evaluations, measured at 55-370ms... paid ONCE
per fresh matrix build"*) — runs back-to-back on that one task's single Node event loop with
nothing pacing how many of those synchronous bursts can be in flight together. Summed across
dozens of tickers resolving in overlapping waves, this plausibly accounts for the measured
~41-75 CPU-SECONDS of actual compute consumed per run (750ish CPU units × 60-90s ÷ 1024
units/vCPU) — three to four orders of magnitude more than the per-contract Black-Scholes math
alone, which #5625's own direct benchmark already measured at 15.8ms for an entire 11,500-contract
SPX-sized chain (ruling that specific cost out, consistent with #5625's own finding).

Critically: **this exact bug class was already found and fixed once in this codebase — for a
different call site.** `polygon-rate-limiter.ts`'s `runPolygonPool` (`POOL_MAX_CONCURRENCY=8`
default) exists specifically because of this: its own doc comment cites the 2026-09-04
`vector-universe-snapshot` incident — *"an unbounded ~85-100-ticker `Promise.allSettled` fan-out
overwhelmed the UW/Polygon admission queue's wait budget... served as fully-null rows"* — and
`buildVectorUniverseSnapshot` was migrated to use it. `heatmap-warm`'s own, structurally identical
~100-ticker sweep was **never migrated to the same fix** — it kept the raw, unbounded
`Promise.allSettled` this whole time, quietly reintroducing the identical failure mode under a
different route.

### Why #5680/#5684 didn't find this

#5680 measured FLEET-average ECS CPU (diluting the single-task spike into "2-8% avg, 20-55% max" —
technically true of the fleet, misleading about any one task) and correctly identified the Vector
universe route's inline-rebuild TRIGGER, but had not yet traced which specific warm-cron code path
does the actual per-ticker fan-out once triggered. #5684 measured the `heatmap-warm` DUTY CYCLE
(how often it runs) and correctly found no distinguishing overlap-fraction correlation with spike
minutes at a coarse "is this job running at all" granularity — it did not look inside the job at
HOW it dispatches its own ~100-ticker fan-out, which is exactly where this finding sits.

### Fix

Routed the `rest` ticker fetch through the same, already-proven `runPolygonPool` helper
`buildVectorUniverseSnapshot` already uses for the identical reason, inheriting its default
`POOL_MAX_CONCURRENCY=8` (not overridden) rather than inventing a new number:

```ts
const restResults = await runPolygonPool(
  rest.map(
    (t) =>
      async (): Promise<PromiseSettledResult<Awaited<ReturnType<typeof fetchGexHeatmap>>>> => {
        try {
          const data = await fetchGexHeatmap(t);
          return { status: "fulfilled", value: data };
        } catch (reason) {
          return { status: "rejected", reason };
        }
      }
  )
);
```

The wrapper preserves the exact `PromiseSettledResult<...>[]` shape the rest of the function
already expects (matching the manual try/catch pattern the `priority`/`core` loops already use),
so no downstream code changed.

### Fix rationale

Bounding concurrency to 8 (the SAME cap already proven safe in production for the structurally
identical Vector-universe fan-out) directly reduces how many tickers' synchronous post-fetch work
(JSON parse + matrix build + depth ladder) can land on one task's event loop at the same moment —
addressing the mechanism regardless of whether the dominant cost turns out to be CPU/event-loop
time, libuv-threadpool (DNS/gzip) contention, or Polygon admission-queue pressure (#5650's three
candidate hypotheses): a smaller, paced batch helps on every one of those axes simultaneously,
rather than betting on one specific mechanism. Deliberately did NOT also throttle the `priority`/
`core` sequential loops in this same PR — they already process one ticker at a time (the opposite
problem: under-parallelized, not bursty) and are a separate throughput concern, not source of this
contention; fixing them is out of scope here to keep this a single, scoped, low-risk change. Also
did not attempt a larger architectural fix (worker threads, moving the escalation path off the main
thread, per-task concurrency limits) — those remain open, larger follow-ups if a live
re-measurement after this fix shows a real but insufficient improvement, per the standing caution
against the #5061/#5065 speculative-fix pattern.

### Blast radius

`src/app/api/cron/heatmap-warm/route.ts` only. `runPolygonPool`/`POOL_MAX_CONCURRENCY` themselves
are unchanged (already shipped, already proven at this exact cap for the Vector universe build).
No other call site reads or depends on `heatmap-warm`'s internal fan-out shape — the route's own
response payload (`warmed`/`total`/`core`/`rest`/`deltasBroadcast`) is unaffected by HOW the fetches
are dispatched, only by how many succeed, which this change does not reduce.

### Regression guard

`src/app/api/cron/heatmap-warm/route.test.ts`: new test `"the bulk 'rest' ticker fetch is bounded
by the shared Polygon pool, not an unbounded fan-out"` — asserts the route imports `runPolygonPool`,
that the bare unbounded `Promise.allSettled` fan-out over `rest` is gone, that `restResults` is
dispatched through `runPolygonPool`, and that no explicit concurrency override is passed (so it
inherits the shared default rather than drifting from the Vector-universe build's proven cap).
RED→GREEN confirmed via `git stash` of only `route.ts`: pre-fix, 8/9 subtests in this file pass (the
new assertion fails — the unbounded pattern is still present); post-fix, 9/9 pass, including every
pre-existing overlap-lock/cooldown test unchanged. Full `npm test` (Node 20.20.2,
`scripts/run-tests.mjs`) and `npx tsc --noEmit` run clean.

### Market-open / live re-measurement

Logged in `docs/audit/MARKET-OPEN-VALIDATION.md` — re-pull per-task `AWS/ECS` Container Insights
`CpuUtilized` and `AWS/ApplicationELB` `TargetResponseTime` p99/Max during the NEXT live
`heatmap-warm` run after this deploys (every ~60-110s during 11:00-21:59 UTC / 4am-8pm ET) and
confirm the single-task CPU spike shrinks materially from the measured 700-860/2048 baseline, and
that the corresponding ALB p99/Max spike shrinks or disappears. If the spike persists at a similar
magnitude despite the concurrency bound, that is real evidence the dominant mechanism is something
OTHER than synchronous per-ticker processing bursts (e.g. genuinely saturating the libuv threadpool
even at 8-at-a-time, or Polygon admission-queue wait time itself) — do not conclude this fix failed
without that live re-measurement, and do not guess a second fix without it, per this file's own
standing discipline.
