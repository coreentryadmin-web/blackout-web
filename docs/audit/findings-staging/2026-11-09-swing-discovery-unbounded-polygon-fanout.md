> **kind:** `FINDING`

## `swing-discovery` cron's two unbounded Polygon fan-outs (up to 40 concurrent calls each) are a real, self-inflicted contributor to the shared circuit breaker tripping — 0/30 successful runs in 24h

| | |
|---|---|
| **Status** | FIXED |
| **Area** | Night Hawk Swings discovery — `src/app/api/cron/swing-discovery/route.ts` |
| **Severity** | P1 — the cron's own `runs_24h` showed **0 successful runs in 24 hours** (`ok:0, failed:30, skipped:21`); Swing discovery/commit was completely dark for the whole window |

### Root cause

Live evidence (2026-11-09, `GET /api/admin/cron-health`, two reads ~2 minutes apart): `swing-
discovery` showed `status:'failed'`, `last_message:'Polygon /v2/aggs/grouped/locale/us/market/
stocks/2026-11-09 → 429 (rate limited)'`, `runs_24h:{ok:0,failed:30,skipped:21}` — zero successful
runs in the trailing 24h. This is mechanically distinct from the already-documented Polygon/Massive
real-time-snapshot entitlement outage (CLAUDE.md's 2026-11-07/08 notes, a 403/`NOT_AUTHORIZED`
billing issue): a 403 can never trip this breaker (`notePolygonOk()` fires on ANY non-429 response,
including a 403, resetting the consecutive-429 counter to 0) — this is a genuine 429 rate-limit
trip of `src/lib/providers/polygon-rate-limiter.ts`'s reactive circuit breaker
(`CIRCUIT_429_THRESHOLD = 5` consecutive real 429s opens it for `CIRCUIT_PAUSE_MS` = 60s). That
breaker is a SINGLE, cluster-wide gate (Redis pub/sub `blackout:polygon:breaker` — "there is
exactly one breaker" per the module's own header comment), so once ANY caller trips it, EVERY
other Polygon caller process-wide sees `isPolygonCircuitOpen()` true and gets `[polygon] Circuit
open — rate limited, pausing Xs` thrown at them too, even if they themselves never drew a 429.

Investigating `swing-discovery/route.ts`'s real call shape (not assuming the numbers in the
original brief for this investigation were still accurate — one of them was not, see below) found
it has **two genuinely unbounded `Promise.all` fan-outs**, each firing up to 40 concurrent Polygon
REST calls with no local concurrency limit of its own, relying entirely on the breaker to
self-regulate instead of bounding its own burst:

1. **`fetchIntradayStructureBars`** (the Wave C1 hybrid intraday-refresh dep, lines ~148-173
   pre-fix): `await Promise.all(tickers.map(async (t) => { const bars = await
   fetchStockMinuteBars(t, to, to)... }))` over up to `BREAKOUT_INTRADAY_REFRESH_LIMIT` (40)
   tickers. Gated behind the `BREAKOUT_INTRADAY_REFRESH` env flag, which `docs/audit/NIGHTHAWK-MAP.
   md` confirms is **`"1"` in production** ("swing-discovery intraday refresh") — not a dormant
   code path. `discovery.ts`'s own `runSwingDiscoveryScan` only invokes this dep on the
   `MIDDAY`/`POWER_HOUR`/`PRE_OPEN` phases (not every scan), but those are 3 of the 5 scan phases
   each session day.
2. **The post-scan watch-ticker last-trade refresh** (lines ~457-468 pre-fix): `await
   Promise.all(watchTickers.map(async (ticker) => { const trade = await
   fetchStockLastTrade(ticker)... }))` over up to 40 tickers (`watchTickers.slice(0, 40)`). This
   one is **not phase-gated** — it runs after every successful scan, making it this route's most
   frequent Polygon burst.

### What the original brief got right vs. wrong (verified against current `main`, not assumed)

The task brief that prompted this investigation also named a third candidate — `closesFor()`'s
memoized `fetchStockDailyBars` fan-out inside `buildDiscoveryDeps`, used by both
`fetchSpyCloses` and every candidate's `enrichCandidate` (`fetchDailyCloses`) — as "memoized-but-
UNBOUNDED-concurrency... for potentially 100+ tickers." **That characterization is stale as of
`main`:** `enrichCandidate` is called through `discovery.ts`'s own `mapPool(ranked,
cfg.enrichConcurrency, ...)` (concurrency **8**, `DEFAULT_SWING_DISCOVERY_CONFIG.enrichConcurrency`),
added in PR #1248 (2026-07-29, "Parallel Tier-1 enrich (concurrency 8)") specifically to replace an
earlier *sequential* 40-name enrich that blew the 60s ALB/Lambda budget — i.e. this fan-out was
already fixed, in the opposite direction, over three months before this investigation. It is NOT
a live concurrency risk today. Likewise, `fetchChainRows` (`resolveTickerChainRows`, the per-
candidate option-chain resolve) is called in a plain sequential `for` loop in `discovery.ts`
(`for (const d of dossiers) { ... await deps.fetchChainRows(d.ticker); ... }`), never a batch
`Promise.all` — also not a concurrency risk. The two real culprits are the ones listed above,
neither of which the brief named specifically (it only generically flagged "a `fetchStockLastTrade`
batch of 40... if it's similarly unbounded," which — checked — it is).

### Evidence

Live `GET /api/admin/cron-health` (2026-11-09): `swing-discovery` `runs_24h:{ok:0,failed:30,
skipped:21}`, `last_message:'Polygon /v2/aggs/grouped/locale/us/market/stocks/2026-11-09 → 429
(rate limited)'` — the grouped-daily fetch itself failing with a direct 429 (not even a circuit-
open throw) confirms real upstream rate-limit pressure, not merely an already-open breaker from an
unrelated cause. `sibling spx-issues-sync`/`spx-evaluate` showing the breaker-open symptom in the
same window (`'[polygon] Circuit open — rate limited, pausing 14-15s'`) is consistent with ONE
shared cluster-wide breaker tripped by a burst large enough to catch other callers mid-pause — a
40-wide unbounded burst from either of swing-discovery's two fan-outs, landing on top of whatever
else (Vector's bead-recorder sweep, other desks' live reads) is already in flight against the same
limiter, is a plausible and sufficient trigger for that shape.

Direct code confirmation (pre-fix, `git show main:src/app/api/cron/swing-discovery/route.ts`):
both fan-outs are a bare `await Promise.all(tickers.map(async (t) => { ... fetchStockMinuteBars /
fetchStockLastTrade ... }))` with no batching, no worker-pool, and no inter-call pacing of their
own — relying solely on the shared `polygon-rate-limiter.ts` module's own admission queue and
reactive breaker.

### Fix

Routed both fan-outs through `runPolygonPool()` (`src/lib/providers/polygon-rate-limiter.ts`),
**an already-established, already-unit-tested helper built for exactly this fan-out shape** — its
own doc comment traces two prior incidents with the identical root cause ("one batch job firing
dozens of tasks that all try to claim slots simultaneously... starves concurrent LIVE traffic"):
`vector-dark-pool-warm` (FINDINGS.md 2026-09-02, an unbounded ~55-ticker UW fan-out) and the Polygon-
side `vector-universe` snapshot (2026-09-04, an unbounded ~85-100-ticker fan-out that served
several genuinely-available tickers as null). `runPolygonPool` is already the call pattern used by
`vector-universe.ts`, `polygon-options-gex.ts`, and `heatmap-warm/route.ts` for this same class of
problem — this reuses that existing, precedented primitive rather than inventing a new batching
scheme. Default concurrency (`POOL_MAX_CONCURRENCY` = 8, env-overridable) also matches this same
file's own `enrichConcurrency` = 8 used for the Tier-1 candidate-enrichment fan-out, so all three of
this route's Polygon-heavy fan-outs are now bounded consistently at 8-wide.

### Fix rationale — why `runPolygonPool`, not PR #7585's manual batch+sleep pattern

PR #7585 (2026-11-07, `GET /api/admin/swing/multi-truth-grade`) fixed an analogous shared-breaker
trip with a bespoke `BAR_FETCH_BATCH_SIZE`/`BAR_FETCH_BATCH_DELAY_MS`/`sleep()` loop, because that
route had no existing bounded-pool helper to reach for. Here, a more directly on-point, already-
proven-in-this-exact-codebase primitive exists specifically for bounding Polygon REST fan-outs
(`runPolygonPool`, with its own test coverage in `polygon-rate-limiter.test.ts` and three real
production call sites already using it for the identical problem shape) — reusing it is the more
conservative and more consistent choice than reimplementing batching inline a fourth time. Deciding
between the two established patterns, in a case where either was defensible, is itself part of the
scoped investigation this fix required.

### What was NOT changed (deliberately)

- `polygon-rate-limiter.ts`'s shared breaker threshold (`CIRCUIT_429_THRESHOLD`), pause duration
  (`CIRCUIT_PAUSE_MS`), or the breaker mechanism itself — a shared, cluster-wide primitive other
  callers depend on; changing it would be out of scope and risky, and was explicitly excluded from
  this task.
- The already-documented Polygon/Massive entitlement 403 outage — a separate, billing/plan-side
  issue, not fixable from code, and mechanically distinct (a 403 never trips this breaker).
- `spx-evaluate`/`spx-issues-sync` — a sibling task's own scope (fixing that route's lack of error
  isolation for its I:SPX fetch); not duplicated or touched here.
- Swing discovery's own candidate-selection/scoring logic — only the concurrency/pacing of its
  upstream Polygon fetches changed; which tickers are evaluated, and for what, is untouched. The
  full `src/lib/swing/discovery.test.ts` suite (155 tests, unchanged) stays green, confirming no
  behavioral drift to the discovery logic itself.
- `closesFor`'s `fetchStockDailyBars` fan-out and the sequential `fetchChainRows` loop — verified
  not to need this fix (see "What the original brief got right vs. wrong" above); changing either
  would be scope creep against evidence, not a fix.
- `src/lib/zerodte/breakout-discovery.ts` (the 0DTE engine) has a near-identical unbounded
  `Promise.all` fan-out over the SAME `BREAKOUT_INTRADAY_REFRESH`/`BREAKOUT_INTRADAY_REFRESH_LIMIT`
  flag/constant (swing-discovery's own copy is a duplicate of this logic, not a shared import) —
  noted here for whoever next sweeps 0DTE, but deliberately left untouched: this task's scope is
  specifically swing-discovery, and the live evidence driving this fix is about Swing, not 0DTE.

### Blast radius

Single file, two call sites, both inside `src/app/api/cron/swing-discovery/route.ts`'s
`buildDiscoveryDeps()`/post-scan watch-refresh block. No change to any exported type, any other
route, or `discovery.ts`'s pure core. `runPolygonPool` itself is unchanged (reused, not modified),
so every one of its existing call sites (`vector-universe.ts`, `polygon-options-gex.ts`,
`heatmap-warm/route.ts`) is unaffected.

### Evidence (RED → GREEN)

Two new regression tests added to `src/app/api/cron/swing-discovery/route.test.ts` (source-text
assertions, matching this file's own existing convention — the route needs a full auth/DB/provider
mock harness to exercise directly, which this test file has never had):
- `swing-discovery bounds the intraday-structure minute-bar refresh fan-out via runPolygonPool, not
  a bare Promise.all`
- `swing-discovery bounds the watch-ticker last-trade refresh fan-out via runPolygonPool, not a
  bare Promise.all`

**RED** (confirmed via `git stash` isolating the route.ts fix from the test file, then reapplying
only the new tests against the pre-fix source): both new tests fail —
`AssertionError: the up-to-40-ticker fetchStockLastTrade refresh must go through the bounded pool`
and the equivalent for the minute-bar fan-out — while the 4 pre-existing tests in the same file
stayed green (4 pass / 2 fail).

**GREEN** (post-fix): all 6 tests in `route.test.ts` pass. Full relevant suites also green on
Node 20.20.2: `src/lib/swing/discovery.test.ts` (155 tests — unchanged, confirming no regression
to discovery logic), `src/lib/providers/polygon-rate-limiter.test.ts`, `src/features/vector/lib/
vector-universe.test.ts`, `src/lib/providers/polygon-options-gex.test.ts`, `src/app/api/cron/
heatmap-warm/route.test.ts` — all passing (the three sibling `runPolygonPool` call sites,
confirming this reuse doesn't regress them). `npx tsc --noEmit` clean. Full `npm test` run — see
PR for the final count.
