## Live ALB tail-latency incident (2026-10-15, 16:21-16:51 UTC+): Vector bead recorder's 5s universe-wide GEX polling structurally saturates the shared Polygon rate limiter — NOT FIXED, escalated (cross-cutting, needs a design decision)

> **kind:** `FINDING`

| **Status** | NOT FIXED — escalated to the #4076 Claude↔Cursor channel; needs a cross-cutting design decision, not a quick patch |
|---|---|

**Context — what this is NOT.** `docs/audit/MARKET-OPEN-VALIDATION.md` entry #388 (PR #6055,
merged today 2026-10-15 04:40 PT / 11:40 UTC) already fixed a *different, real* bug on the same
shared code path: `fetchGexHeatmap()`'s stale-while-revalidate branch was kicking off a DETACHED
background rebuild with **no concurrency cap**, triggered by `heatmap-warm`'s own ~46-209s cron
dispatch. That fix added `shouldStartHeatmapBackgroundRebuild` (default cap 8 concurrent, process-
wide) and is correct and settled — do not re-litigate it. This finding is about a **separate,
continuously-running trigger on the same `fetchGexHeatmap`/full-chain-escalation path that #6055's
cap does not resolve**, discovered while investigating a live, still-ongoing ALB degradation.

**Root cause.** `src/lib/vector-bead-recorder-leader.ts`'s universe sweep fires every
`VECTOR_BEAD_RECORD_TICK_MS` = 5s (`vector-bead-recorder-logic.ts`) and, per ticker, calls
`recordVectorUniverseWallSample` → `buildVectorUniverseRow` (`vector-universe.ts:131`) →
`fetchGexHeatmap(ticker)` — the exact same shared, canonical function every other Polygon-GEX
caller (heatmap-warm, member page reads, Largo tools, SPX desk, Thermal) uses. `fetchGexHeatmap`'s
cache TTL is a flat **5s for every ticker** (`gexHeatmapCacheMsFor`, `polygon-options-gex.ts:1739`).
So the recorder's own polling cadence is **at or below** the shared cache's own TTL — by design,
not by accident: `wallTrailSampleSecForTicker`'s doc comment states "universe scope...always 5s",
reaffirmed across several past PRs (2026-08-07, 2026-08-12, 2026-08-18, 2026-08-19) that each fixed
a *regression away from* 5s density back to 5s. That history matters: this cadence is deliberate,
fought-for product intent, not a tunable left at a careless default.

The practical effect: on (almost) every single 5s tick, every ticker in the ~100-122-name shared
Vector universe is already past its 5s TTL, so it re-enters `fetchGexHeatmap`'s
stale-while-revalidate branch (now capped at 8 *concurrent* rebuilds **per process**, post-#6055)
or, when a shard overruns far enough to cross the 90s `maxStaleMs` ceiling, the **uncapped**
single-flight cold-build path (`heatmapInflight` / `sharedCacheSetNx`-only, no global throughput
cap at all). Either way, the recorder re-requests the *entire* universe's GEX matrix roughly every
5-10s, continuously, for the whole RTH session — not a one-off burst.

Many universe tickers also have structurally thin banded option chains and so trip
`shouldEscalateToFullChain` (`polygon-options-gex.ts:2370`) on **every single rebuild**, doubling
the Polygon request cost for that ticker (one banded fetch + one full unfiltered-chain fetch,
`fetchHeatmapBandUnfiltered`).

**Evidence (live, gathered via CloudWatch Logs Insights + Metrics, `/ecs/blackout-production`,
target group `blackout-production-app/8841ca2aeba05d87`, all times UTC 2026-10-15):**

- **`[polygon-gex] full-chain escalation ADOPTED` rate jumps 6-8x exactly at 13:30 UTC** (= 9:30am
  ET, cash RTH open — the `isEtCashRth()` gate the recorder's `tick()` checks): 150-400/15min
  pre-open (background load from `heatmap-warm`'s own extended-hours cron) → sustained
  **700-1,300/15min (47-87/min) continuously from 13:30 UTC through the time of this investigation
  (~17:11 UTC), 3.5+ hours**, never dropping back down. This is a sustained condition, not a burst.
- **3-minute sample (188 events, 80 unique tickers)**: top repeater `CRWV` escalated **19 times in
  180s** (~every 9.5s) — matching the recorder's own degraded per-shard cadence almost exactly (see
  next bullet), i.e. this one ticker's banded pull is thin on *every single rebuild*, not
  occasionally.
- **`[vector-bead-recorder] SWEEP OVER BUDGET` fires continuously, every ~61-75s, every single
  firing** from at least 15:14 UTC through 16:57 UTC (54 lines in the 1h window checked, zero
  gaps): "sweep 8000-9960ms for 11/11 tickers" against the 5s budget — i.e. one shard (11 tickers)
  routinely takes ~1.6-2x its allotted budget, confirming the whole universe is structurally
  landing past its own 5s TTL on every poll, not merely occasionally.
- **Direct smoking gun — the shared Polygon rate limiter itself is saturated**: live at 16:54:53
  UTC, dozens of DIFFERENT tickers (`PCOR, QBTS, PURR, VICR, QUBT, ORCX, CRML, ETHU, KD, BBWI, PM,
  TT, PENG, AM, GME, BITX, MSTY, FIGR, PWP, VYX, TOST, NAVN, ETHT, ARQT, TRU, SOFX, SOFI, NOWL, KSS,
  NVST, ...`) all logged `[polygon-gex] chain fetch threw ... [polygon] rate-limiter queue budget
  exceeded at global_rps` / `at local_slot` in the **same millisecond**. This is the shared, global
  Polygon rate limiter (`polygon-rate-limiter.ts`) — used by every Polygon-consuming surface in the
  product (0DTE discovery/commit, SPX desk, Thermal, Largo tools, Vector), not just Vector's own
  tickers. The failing tickers above are not all Vector universe names, which means **this
  contention is cross-product**: Vector's own continuous polling volume is large enough to starve
  other callers' chain fetches of their share of the shared rate budget.
- **ALB `TargetResponseTime` (target group `blackout-production-app`)**: "baseline" window
  15:34-15:49 UTC (already inside RTH, recorder already running) p99 **19.5-20.8s** — itself not a
  healthy number, it just predates the operator noticing further degradation. Degraded window
  16:24-16:54 UTC: p99 **31-50s**, Max **105-120s**. Still elevated as of this check (17:09 UTC):
  p99 22.65s, Max 65.5s. RequestCount **dropped** in the same window (per the operator's own prior
  measurement) and ECS CPU stayed flat 22-30% — consistent with queue/contention-bound tail latency
  (fewer total requests completing, the ones that do are stuck behind Polygon rate-limiter queue
  waits shared with Vector's continuous churn), not a volume or CPU problem.
- A rolling ECS deploy was also in flight around 16:59 UTC (`blackout-production-web:2021` created
  16:59:38Z alongside an older active `:2020` from 12:53:51Z) — noted as a plausible contributing/
  confounding variable, but NOT the root cause: the degraded pattern (both the log-rate jump and
  the elevated ALB baseline) was already present for 3+ hours before this specific deploy started,
  tracking the 13:30 UTC RTH-open gate, not any single deploy event.

**Verdict on the three hypotheses this investigation was asked to distinguish:** **(b)** — a
genuinely new/different, much higher-frequency source (`vector-bead-recorder`, 5-10s cadence
across the full ~100-122-ticker universe) hitting the *same* shared `fetchGexHeatmap`/
full-chain-escalation code path #6055 already touched, but through a different entry point and at
a scale #6055's per-process concurrency cap does not bound (the real bottleneck one layer up —
the shared Polygon global rate limiter — has no per-caller budget at all). Not **(a)**: this is not
`heatmap-warm`'s slow-dispatch pattern recurring, it is a structurally continuous driver that has
been running every RTH session since well before #6055. Not **(c)**: 47-87 escalations/min
sustained for 3.5+ hours, plus live rate-limiter queue-exceeded errors on dozens of concurrent
tickers, is well outside any reasonable "healthy, bounded" description.

**Why no quick fix was shipped (per this task's explicit instruction not to speculate on a
cross-cutting shared layer).** Every candidate fix touches something with a blast radius well
beyond this incident:
1. **Throttling the recorder's own cadence or GEX-read frequency** would directly reverse
   deliberate, repeatedly-reaffirmed product intent (5s bead density for the whole shared universe,
   restored across at least four prior PRs after regressions to 10s/30s/60s) — exactly the kind of
   confident-but-wrong guess the standing caution about the two already-failed SPX-desk fix
   attempts (#5061, #5065) warns against. It would need a product-level sign-off on acceptable bead
   staleness, not a unilateral engineering call.
2. **Changing `fetchGexHeatmap`'s TTL, SWR acceptance window, or concurrency cap** is the literal
   shared layer every Polygon-GEX consumer in the product depends on (0DTE, SPX, Thermal, Largo
   tools, Vector, member page reads) — the exact "cross-cutting change to a shared cache layer used
   by many callers" this task was explicitly told not to speculate on.
3. **Giving the Polygon global rate limiter a per-caller sub-budget** (so a background recorder can
   never starve interactive member-facing traffic of its share) is architecturally the most
   promising real fix, but it is new design surface in `polygon-rate-limiter.ts` — a shared
   dependency across the whole platform — and deserves a deliberate design pass, not a same-session
   patch under live-incident pressure.

**Recommendation.** Posted as a comment on PR #4076 (the durable Claude↔Cursor cross-cutting
collaboration channel) with this same evidence, proposing the per-caller rate-limiter sub-budget
(option 3 above) as the most promising direction and asking Cursor to independently confirm/
challenge the causal chain (recorder cadence → shared-TTL churn → full-chain escalation volume →
global rate-limiter saturation → cross-product tail latency) before either agent attempts an
implementation. The `#388`/#6055 fix should stay as-is; it is correct for the case it targets.

**Next step for a future session:** re-run the three CloudWatch queries in this file (full-chain
escalation rate by 15-min bin, `SWEEP OVER BUDGET` frequency, rate-limiter-exceeded log lines) to
confirm whether the condition is still live, and check PR #4076 / shared Autopilot state for
Cursor's response before proposing an implementation.
