## 2026-10-08 — [FINDING, largo-swing] `vector-full-state-snapshot`'s cache-warm cron permanently starves every ticker after its first time-budget batch, silently dropping Vector/ecosystem evidence from every Ask Largo swing play-brief for any non-first-two ticker — FIXED (rotating warm cursor)

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P2 (no bad numbers served — every affected section degrades honestly to `unavailableSources`/"fetch failed", per the Largo absence contract — but a real, member-facing evidence gap on 100% of sampled swing play-briefs, including for real open-capital positions) |
| **Component** | `src/app/api/cron/vector-full-state-snapshot/route.ts`, `src/features/vector/lib/vector-full-state-warm-universe.ts` |
| **PR** | fix/vector-full-state-warm-starvation |
| **Found via** | Standing Ask Largo deep-dive sub-mandate, `GET /api/market/swing/play-brief` live audit (this cycle) |

### Root cause

`vector-full-state-snapshot` (the cron that proactively warms `vector:full-state:{ticker}:
{horizon}` — the Redis cache `fetchVectorFullState`/`fetchEcosystemContext` read cache-first, and
Ask Largo's swing play-brief reads via both) iterates its ticker universe in a **fixed order**
(static allowlist first, then dynamic/open-swing-position names appended —
`mergeSharedUniverseTickers`) and stops early once `Date.now() - started > TIME_BUDGET_MS`
(50s), a check that only runs **between** batches, not within one.

Live-measured this cycle: **13 consecutive runs over 3+ hours** each logged `written=8` (exactly
one `TICKER_CONCURRENCY=2 × 4 horizons` batch) against a 59-62-ticker universe, `elapsed=
77220-146306ms` (1.5-3x the configured 50s budget), `budgetHit=true` every single time:

```
[cron/vector-full-state-snapshot] background done — tickers=59 horizons=4 written=8 skippedNoSpot=0 failed=0 budgetHit=true elapsed=136415ms
[cron/vector-full-state-snapshot] background done — tickers=60 horizons=4 written=8 skippedNoSpot=0 failed=0 budgetHit=true elapsed=129607ms
[cron/vector-full-state-snapshot] background done — tickers=62 horizons=4 written=8 skippedNoSpot=0 failed=0 budgetHit=true elapsed=77220ms
```

Because the iteration order never changes run to run, this isn't "slightly slower coverage" (the
outcome the code's own comments anticipate — "partial completion is fine... the next run... fills
whatever this run didn't reach") — it's a **hard, permanent 0% coverage** for every ticker after
the first ~2 static names, forever. That silently falsifies the cron's own stated self-healing
invariant, and reproduces — for a DIFFERENT reason — the exact gap
`vector-full-state-warm-universe.ts` was built to close for HUT on 2026-09-26 (a real open swing
position never getting warmed): that fix added open positions to the merged ticker list, but
appended after the static allowlist, which this starvation bug means they can never reach.

### Evidence — confirmed live in Ask Largo's own swing play-brief

Pulled `GET /api/market/swing/play-brief` for three tickers never dived this session — NET
(WATCH), INTC (a real OPEN swing position, `positionId 50`), BE (CLOSED) — through the standard
temp-Clerk-session auth helper. **All three**, every time, carried the identical
`unavailableSources`:

```json
[
  {"source": "ecosystem context", "reason": "fetch failed", "retryable": true},
  {"source": "Vector state", "reason": "fetch failed", "retryable": true}
]
```

CloudWatch (`/ecs/blackout-production`) confirms the underlying cause for all three, and for
every other `swing-play-brief` invocation logged over the same 3+ hours (26 lines = 13 pairs,
100% failure rate, zero successes observed):

```
[swing-play-brief] ecosystem context fetch failed for INTC: SwingBriefSourceTimeout: brief source read exceeded 8000ms
[swing-play-brief] Vector full-state fetch failed for INTC: SwingBriefSourceTimeout: brief source read exceeded 8000ms
```

INTC is a real, currently-OPEN swing position (held with real member capital) — exactly the
highest-stakes case `vector-full-state-warm-universe.ts`'s own header says this cache-warming
exists to protect. It is included in `activeVectorFullStateTickers()`'s output, but sits far
enough into the merged list that the starved cron never reaches it.

### Fix

`rotateTickersForWarmPass(tickers, cursor)` (new, pure, in `vector-full-state-warm-universe.ts`,
9 unit tests) rotates the ticker list to start at a persisted cursor instead of always index 0.
The cron (`route.ts`) now reads the cursor from Redis (`vector:full-state-snapshot:cursor`,
fail-open to `0`), rotates the universe before iterating, and after the run persists
`cursor + attempted` (mod universe length) so the **next** run resumes where this run's budget
cutoff left off. Over successive 5-min runs this guarantees every ticker in the merged universe —
including a real open swing position far down the list — eventually gets its turn, which is the
exact guarantee the cron's own pre-existing comments already assumed was true.

### What this does NOT fix (deliberately out of scope here)

The real per-ticker cost driving the 50s-budget overrun (a cold `computeVectorFullState` paying a
chain fetch — `fetchReconstructChain` in `vector-gex-reconstruct-server.ts`, up to 60 paginated
`/v3/snapshot/options/{underlying}` Polygon pages per ticker, serialized awaiting the shared
cluster-wide rate limiter) is untouched. That is almost certainly connected to the already-open
ALB tail-latency investigation (elevated p99 this morning) and needs its own measurement before
touching a shared hot path several other Vector/Thermal/Largo readers depend on — rotating the
warm order fixes the STARVATION (some tickers never get a turn, forever) without betting on a
guess about the EXPENSIVE call itself. Once the universe is small enough, or the chain fetch gets
cheaper, every ticker's cache will stay fresher; until then, rotation at least bounds the worst
case to "stale by N runs" instead of "never warmed, ever."

### Blast radius

Only this one cron's iteration order changed. No change to `computeVectorFullState`,
`fetchVectorFullState`, `fetchEcosystemContext`, the swing play-brief composer, or any other
reader of the `vector:full-state:*` cache — all of them already treat a miss as an honest
cache-miss (self-warm on read, 8s budget, `unavailableSources` disclosure) exactly as before.
