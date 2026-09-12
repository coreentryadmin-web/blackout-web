## GEX heatmap build (`buildGexHeatmapUncached`) blocked the shared web ECS event loop for up to 86s — RTH ALB p99 hit 58-70s — fix/meridian-gex-heatmap-event-loop-yield — 2026-09-12

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P1 — measured, real member-facing tail latency during RTH, same root-cause shape as the already-fixed Vector background-cron event-loop issue (#4807), but worse in magnitude. |

**What was broken (measured via `AWS/ApplicationELB` `TargetResponseTime` on `blackout-production-app`'s target group, extended statistics, 24h window through 2026-09-12 02:00 UTC):** p99 hit **58-70 seconds** during 11:00-19:00 UTC on 2026-09-11 (spanning pre-market through most of RTH) while p50 stayed under 0.6s the whole time — a classic tail-latency signature, not fleet capacity. Cross-referencing CloudWatch Logs `/ecs/blackout-production` for `elapsed=` in that same window found `cron/meridian-warm` as the dominant offender: 28 runs, averaging **40.9s**, peaking at **86s** — timing that lines up almost exactly with the ALB p99 spikes.

Root cause, traced into `src/lib/providers/polygon-options-gex.ts`'s `buildGexHeatmapUncached` (the function `meridian-warm` reaches via `warmMeridianCaches` → `fetchGexHeatmap("SPX")`, dispatched via `after()` onto the SAME shared `blackout-production-web` ECS service that serves live member traffic — same dispatch shape as the already-fixed Vector crons):

1. **SPX's chain is confirmed large** — a comment on `HEATMAP_PAGE_GUARD` (line ~1907) already documents "SPX's ±6% band needs 46 pages / 11,254 contracts to fully paginate," measured live.
2. **`maxPainByExpiry` (was line 3628-3634) is genuinely O(n²) per expiry, run ~20-23 times with zero yields.** `computeMaxPainFromChain` is O(strikes²) (nested loop over up to 500 strikes ≈ 250,000 ops per call). The loop over `sortedAll` (every near+far expiry) re-filters the full ~11K+ contract array AND re-runs that O(s²) pass for EVERY expiry, all in one continuous synchronous JS turn — worst case several million synchronous operations back-to-back with no `await` anywhere in between.
3. **The depth-ladder loop over `nearKeep`** (was line 3688-3698) compounds this further — `buildDepthBlockForExpiries` re-scans the full ~11K-contract `depthContracts` array once per near-term expiry, also with zero yields.
4. **Confirmed NOT I/O-bound**: the chain-fetch pagination (`fetchHeatmapBandLoHi`) already correctly `await`s between pages, which explains wall-clock time but does not block the event loop — that part was already fine. The blocking is entirely in the POST-fetch, in-memory computation stretch.

**What changed:** Added `await new Promise((resolve) => setImmediate(resolve))` — a genuine macrotask-level yield (not a microtask-only `Promise.resolve()`, same distinction the Vector fix relied on) — inside both hot loops:
- Once per iteration of the `maxPainByExpiry` loop (the dominant O(n²) cost, now the highest-value yield point).
- Once per iteration of the `nearKeep` depth-block loop.

This caps the maximum contiguous event-loop block to roughly one expiry's own O(n) filter + O(s²) max-pain pass, instead of the whole ~20-23-expiry sweep — same mitigation shape as PR #4807 (Vector), applied to a worse hot loop (O(n²) per-expiry, not O(n) per-contract accumulation).

**Blast radius:** `buildGexHeatmapUncached` is shared by every caller of `fetchGexHeatmap` (Meridian's own SPX GEX prefetch via `meridian-warm`, the live `/api/market/gex-heatmap` route, `desk-warm`, and any other consumer of the GEX matrix for a large-chain ticker) — the fix benefits all of them, not just Meridian's warm cron. Names with small chains (most single stocks) were never at meaningful risk; SPX/SPY/QQQ/IWM (the biggest chains) are where this mattered most.

**Fix rationale:** Minimal, additive-only change — no computation logic touched, only where control yields back to the event loop. Chose per-iteration yields (not batched every N) because the per-iteration unit of work (one expiry's O(s²) pass) is already the natural granularity the Vector fix batched by ticker at, and there are only ~20-23 iterations so the yield overhead itself is negligible next to the multi-second computation it interrupts.

**RTH check:** Re-pull `AWS/ApplicationELB` `TargetResponseTime` p99 for the same 15-30 min granularity during the next `meridian-warm` invocations at RTH open — should stay materially below the 58-70s spikes measured pre-fix (a few seconds at most would confirm the fix; anything still spiking into double-digit seconds means the yield granularity needs tightening further, e.g. yielding mid-loop within a single very-large expiry's max-pain pass, not that the approach was wrong). Also worth re-checking `cron/meridian-warm`'s own logged `elapsed=` — should drop well below the pre-fix 40.9s average, though total wall-clock won't shrink much (the fix doesn't reduce total work, only how it's chunked against the event loop) — the real signal is the ALB p99 during the same window, not the cron's own elapsed time.

**Related, separate findings from the same investigation (not fixed here, flagged for follow-up):**
- Redis primary node (`blackout-production-redis-rg-001`) `DatabaseMemoryUsagePercentage` sits at 95-98% even off-hours, hitting sustained 99.5-100% with real eviction pressure (peak 396 evictions/30min) during the same 13:35-19:35 UTC window — a real, separate infra-capacity concern needing either a node-size decision or a cache-key audit, not a code fix from this sandbox.
- `blackout-production-market-worker` ECS CPU repeatedly hit 99-100% max during 16:05-19:35 UTC — worth its own investigation, separate from the web-tier event-loop issue this PR fixes.
- Live UI audit across `/nighthawk`, `/vector`, `/heatmap`, `/terminal`, `/flows` found 0 console errors and 0 real 4xx/5xx, but flagged two single-measurement slow API calls worth re-checking under load: `/terminal`'s `GET /api/market/largo/status` at 4.3s, and `/heatmap`'s multi-ticker GEX batch fetch contributing to an 11.5s total load event.
