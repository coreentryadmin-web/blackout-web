> **kind:** FINDING

## `fetchUwGreekExposureExpiry` had no cache layer at all — the single highest-frequency fully-live UW call in the app, contributing to recurring ALB tail-latency spikes — FIXED

| **Status** | Fixed (`uwCacheTtlMs()`, `src/lib/providers/unusual-whales.ts`) |
|---|---|

**Found via:** this session's standing performance/latency audit mandate. A live CloudWatch sweep
(2026-10-18) measured `blackout-production-app`'s ALB `TargetResponseTime` over a 3-hour window:
avg=0.85s, p50=0.036s (healthy), but **p99=8.94s, Max=43.2s** — a tail-latency problem, not a
capacity problem (ECS CPU avg 4.1%/Max 59%, Memory avg 9.2%/Max 32.7%, plenty of headroom). The Max
spikes recurred roughly every 13-51 minutes. `[api-queue-timing]` log lines (UW rate-limiter) showed
bursts of concurrent calls to `/api/economy/gdp`, `/api/economy/cpi`, `/api/economy/unemployment`
and separately `/api/stock/SPX/flow-per-expiry` + `/greek-exposure/expiry` + `/api/net-flow/expiry`
queuing behind the shared rate limiter, with `queue_wait_ms` up to 19,460ms in one observed burst,
timed to line up with the ALB Max spikes.

**Root cause.** Traced both burst clusters to exactly two call sites in `src/features/spx/lib/
spx-desk.ts` — `fetchDeskEnrichmentFields` (fired from the `desk-warm` cron every ~5min RTH, and
fire-and-forget off the live `buildSpxDesk()` path) and `buildSpxDeskFlow` (wrapped by
`loadSpxDeskFlow`, cached for only 2s to match the client's own `SPX_FLOW_POLL_MS` live SWR poll
interval) — both running the same `runUwPooled` fan-out of `fetchUwGreekExposureExpiry`,
`fetchUwFlowPerExpiry`, and `fetchUwNetFlowExpiry` (the economy GDP/CPI/UNRATE triplet is a separate,
already-fixed nested pool inside `fetchUwMacroIndicators`, landed 2026-10-15). This is one legitimate
caller's own fan-out, not duplicated/competing callers.

Of the three pooled calls, two already have caching: `fetchUwFlowPerExpiry` (Redis L2, 120s,
`UW_CACHE_TTL.flowPerExpiry`) and `fetchUwNetFlowExpiry` (in-process L1, 120s, `uwCacheTtlMs`).
**`fetchUwGreekExposureExpiry` had neither** — `uwCacheTtlMs()` had no branch for
`/greek-exposure/expiry` at all (confirmed: zero matches grepping `uw-shared-cache.ts` for
`greekExposure`/`greek-exposure`), so every call went straight into the shared rate-limiter queue.
Because `buildSpxDeskFlow`'s own wrapper revalidates every 2 seconds under live RTH/extended-hours
member polling, this made it the single highest-frequency fully-live UW call in the whole app — hit
roughly every 2 seconds, continuously, all day — competing for the same tiny cluster-wide
`GLOBAL_MAX_CONCURRENCY`/`GLOBAL_MAX_RPS` budget that the periodic 5-min enrichment bursts (which
also re-fetch it, alongside the economy triplet) then collide with. That collision is what tips
queue wait into multi-second territory and produces the correlated ALB p99/Max spikes.

**Confirmed organic production traffic, not audit-script traffic**: both call sites are real cron
(`desk-warm`) and real member-facing live polling, not anything in `scripts/audit/`. A third,
on-demand call site (Largo's `get_greek_flow` chat tool, `src/lib/largo/run-tool.ts:1474`) is not a
recurring-burst contributor.

**Not the fix:** `UW_GLOBAL_MAX_RPS` is already 8 (not the stale "default 2" an older doc note
implied — bumped 2026-10-14), so the real problem is call volume on an uncached hot path, not the
rate ceiling. Raising it further was explicitly not recommended or touched.

**Fix.** Added a `uwCacheTtlMs()` branch for `path.endsWith("/greek-exposure/expiry")` returning a
120s TTL (`UW_GREEK_EXPOSURE_EXPIRY_CACHE_SEC`, matching its two pool-siblings exactly — dealer
positioning-by-expiry doesn't need sub-2s freshness any more than net-flow/expiry or
flow-per-expiry do). Caching is generic through the existing `uwGetSafe`/L1-cache mechanism, gated
purely on `uwCacheTtlMs(path) > 0` — no change needed to `fetchUwGreekExposureExpiry` itself or
either caller.

**Tests.** Added `fetchUwGreekExposureExpiry caches within TTL` to `unusual-whales.test.ts`,
mirroring the existing `fetchUwIvRank` cache-proof test exactly: two sequential calls within TTL
must produce exactly one underlying `fetch`. RED→GREEN proven via `git stash` of the source file
alone (2 !== 1 without the fix, 1 === 1 with it restored). Broader regression:
`src/lib/providers/*.test.ts` + `src/features/spx/**/*.test.ts` + `src/lib/largo/**/*.test.ts` —
2791/2791 pass (1898 providers+largo, 893 spx). `tsc --noEmit`: clean.

**Market-open validation.** Confirm `[api-queue-timing]` log lines for `greek-exposure/expiry` drop
from roughly once/2s to roughly once/120s per unique ticker once this deploys, and that the
recurring ALB p99/Max spikes correlated with this specific burst pattern stop recurring (any
unrelated burst, if one exists, would persist — isolating this fix's actual effect from other
causes).
