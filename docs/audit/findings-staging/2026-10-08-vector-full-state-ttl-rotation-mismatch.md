## 2026-10-08 — [FINDING, largo-swing] `vector:full-state` cache TTL (15min) is ~11x shorter than the measured warm-cron rotation lap (~160min), so the 2026-10-08 starvation fix did not actually close the member-facing gap it targeted — FIXED (TTL raised, honesty unaffected)

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P2 (no bad numbers served — every affected section degrades honestly to `unavailableSources`/"fetch failed", per the Largo absence contract — but the SAME 100% member-facing evidence gap the same-day rotation fix set out to close, still measured at 100% after that fix shipped) |
| **Component** | `src/lib/bie/vector-full-state-cache.ts` (`VECTOR_FULL_STATE_CACHE_TTL_SEC`), `src/lib/bie/vector-state-freshness.ts` (stale header comment corrected alongside) |
| **PR** | fix/vector-full-state-ttl-rotation-mismatch |
| **Found via** | Standing Ask Largo deep-dive sub-mandate, `GET /api/market/swing/play-brief` live audit (this cycle), cross-checked against CloudWatch cron logs |
| **Related** | Same-day earlier finding "`vector-full-state-snapshot`'s cache-warm cron permanently starves every ticker after its first time-budget batch... — FIXED (rotating warm cursor)" (this file, folded into FINDINGS.md). This finding is the next layer down: that fix shipped, is confirmed working (cursor genuinely advances run over run), and still did not close the gap, because nobody checked the TTL against the fix's own measured throughput. |

### Root cause

`rotateTickersForWarmPass` (merged same day) correctly stops the cron from starving the SAME ~2
tickers forever — the cursor advances every run (confirmed live: `cursor=22,26,28,30,32,34,36,38`
across ~30 minutes of consecutive runs), so every ticker in the merged universe eventually gets a
turn. But "eventually" is doing a lot of work: each ~5-min run only completes ONE
`TICKER_CONCURRENCY=2 x 4 horizons` batch before the cron's own 50s `TIME_BUDGET_MS` is blown by the
real per-ticker chain-fetch cost (measured live, same CloudWatch window: `elapsed=51050-117676ms`
per run — 1-2.3x the budget on a SINGLE batch). At 2 tickers warmed per ~5-min cycle against a
64-ticker universe, one full rotation lap takes **~64/2 * 5min = 160 minutes**.

The cache TTL `fetchVectorFullState`/`fetchEcosystemContext` read against is **15 minutes**
(`VECTOR_FULL_STATE_CACHE_TTL_SEC`, chosen on the explicit, now-falsified assumption — stated
verbatim in its own old comment — that it "comfortably outlives the ~5-min RTH cron cadence
so an entry never expires on the knife-edge between two runs"). With a 160-minute real rotation
lap, an entry is warm for 15 minutes out of every ~160 — cold roughly 90% of the time — for
**every** ticker in the universe, not just the ones the OLD fixed-iteration-order bug starved
outright. The rotation fix changed "0% coverage forever" to "sparse coverage, briefly, once every
~160 minutes" — which, against a 15-minute TTL, is barely distinguishable from 0% in practice.

### Evidence

Re-ran the exact same live probe the rotation-fix finding used, on SIX fresh tickers this cycle
(MSFT, PBR, WING, CTVA, MU, AMD — none overlapping that finding's own three), through
`GET /api/market/swing/play-brief`, via the standard temp-Clerk-session auth helper:

```
unavailableSources: [
  {"source":"ecosystem context","reason":"fetch failed","retryable":true},
  {"source":"Vector state","reason":"fetch failed","retryable":true}
]
```

**All six**, every time — 100%, identical to the rotation fix's own pre-fix baseline. Combined with
the three tickers (RBLX, DUOL, CIEN) probed in the immediately preceding audit cycle (same session,
same day, after the rotation fix had already deployed), that is **9/9 sampled tickers across two
separate hours, zero successes**, for both `ecosystem context` and `Vector state` independently.

CloudWatch confirms the mechanism directly — every single one of the 9 calls logged the identical
8-second hard timeout, not a slow-but-eventually-successful read:

```
[swing-play-brief] ecosystem context fetch failed for AMD: SwingBriefSourceTimeout: brief source read exceeded 8000ms
[swing-play-brief] Vector full-state fetch failed for AMD: SwingBriefSourceTimeout: brief source read exceeded 8000ms
[swing-play-brief] ecosystem context fetch failed for MSFT: SwingBriefSourceTimeout: brief source read exceeded 8000ms
[swing-play-brief] Vector full-state fetch failed for MSFT: SwingBriefSourceTimeout: brief source read exceeded 8000ms
... (identical pair, 9/9 tickers, 18 lines total)
```

And the cron's own run log shows the rotation genuinely advancing (so the earlier fix is real and
working), while never completing more than one batch per run:

```
[cron/vector-full-state-snapshot] background done — tickers=64 horizons=4 cursor=36 attempted=2 written=8 ... budgetHit=true elapsed=51050ms
[cron/vector-full-state-snapshot] background done — tickers=64 horizons=4 cursor=34 attempted=2 written=8 ... budgetHit=true elapsed=74664ms
[cron/vector-full-state-snapshot] background done — tickers=64 horizons=4 cursor=32 attempted=2 written=8 ... budgetHit=true elapsed=117676ms
[cron/vector-full-state-snapshot] background done — tickers=64 horizons=4 cursor=30 attempted=2 written=8 ... budgetHit=true elapsed=81934ms
```

MSFT and NRG are real, currently-OPEN swing positions (MSFT: positionId 49, committed 2026-10-07,
live P&L -21.9% at probe time) — exactly the highest-stakes case the rotation fix's own header
names as the reason the merged ticker universe includes open positions at all.

### Fix

Raised `VECTOR_FULL_STATE_CACHE_TTL_SEC` from 15 minutes to 4 hours — comfortably clears the
measured ~160-minute rotation lap with margin for a slower day, while staying inside one RTH
session so entries still naturally age out by the next trading day. Corrected the adjacent stale
assumption in `vector-state-freshness.ts`'s header comment (previously cited "76 computes against
a 50s budget, ~658ms per compute" — also falsified by the same measurement; real per-batch cost is
51-118 seconds for a 2-ticker batch, not milliseconds for 76).

**Why this is safe, not a staleness/honesty regression:** `describeVectorFreshness`
(`vector-state-freshness.ts`) derives `freshness`/`age_seconds`/`note` purely from the snapshot's
own `observed_at` versus the real read instant — completely independent of the Redis TTL. A
longer-lived cache entry is never relabeled as fresher than it is; anything older than 10 minutes
is still correctly tagged `"stale"` with an honest age and an explicit note (Largo C2). The TTL
only controls whether Redis still HAS an entry to label at all. A TTL shorter than the real
rotation lap does not make reads more honest — it just deletes usable (if aging) evidence before
it can be served, trading an honestly-labeled stale read for a hard, evidence-free "fetch failed."
Raising it converts a near-universal timeout into a near-universal honestly-labeled (occasionally
stale) read, which is strictly more informative to both the member and to Largo.

**Why a longer TTL and not a faster/bigger cron:** the real bottleneck is the per-ticker chain-fetch
cost (`fetchReconstructChain`, up to 60 paginated Polygon pages), already explicitly flagged by the
rotation fix's own "what this does NOT fix" section as tied to the open ALB tail-latency
investigation and NOT safe to touch blindly — `TICKER_CONCURRENCY` was deliberately reduced 3→2 on
2026-09-28 after a prior incident where raising concurrency saturated the shared cluster-wide
rate limiter. Raising the TTL fixes the member-facing symptom without touching that shared hot path
or betting on an unmeasured change to it.

### Regression test

`src/lib/bie/vector-full-state-cache.test.ts` — new test asserts
`VECTOR_FULL_STATE_CACHE_TTL_SEC` exceeds one full rotation lap computed from the measured
throughput (64 tickers, 2/cycle, 5-min cycle = 9600s). RED against the old 900s TTL (confirmed via
`git stash` of only the two source files, keeping the new test), GREEN at 14400s. Full suite
(`npm test`, Node 20): 15819 pass / 0 fail / 3 skip. `tsc --noEmit` clean.

### Blast radius

Only the TTL constant and two header comments changed. No change to `computeVectorFullState`,
`fetchVectorFullState`, `fetchEcosystemContext`, `rotateTickersForWarmPass`, the swing play-brief
composer, the cron's concurrency/budget, or any other reader of the `vector:full-state:*` cache —
every reader already treats a cache miss as an honest miss (self-warm on read, its own 8s budget,
`unavailableSources` disclosure) exactly as before; this change only means misses should now be
far rarer.

### What this does NOT fix (deliberately out of scope here, same boundary the rotation fix drew)

The per-ticker chain-fetch cost itself is still untouched — raising the TTL buys headroom, it does
not make the universe warm faster. If the universe grows meaningfully beyond ~64 tickers, or the
chain-fetch cost increases further, the rotation lap grows too and the TTL margin shrinks with it.
The regression test ties the TTL to today's measured throughput so a future session re-measuring
cron logs can tell directly whether the margin still holds, rather than re-discovering the mismatch
from scratch.
