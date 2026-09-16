> **kind:** FINDING

## 0DTE G-1 (`no_market_bias`) shares a per-ticker timeout budget with SPY's own read, concentrating false blocks on QQQ/SPY/SPXW/SPX/DIA — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P1 |
| **Area** | 0DTE (Night Hawk) — `src/lib/zerodte/scan.ts` |
| **PR** | fix/zerodte-spy-bias-timeout |

### Trigger

Operator, live, directly: *"Whole day we dont find plays like spx spy qqq iwm .. tsla nvda ..
Why does the engine not produce plays?"*

### Root cause

`attachIntradayEdge` (scan.ts) computes ONE shared SPY intraday read per scan cycle and hands
its freshness (`biasAsOfMs`) to G-1 (`no_market_bias`, gates.ts), which hard-blocks EVERY
index-ETF/SPX-family setup (QQQ/SPY/SPXW/SPX/DIA — `INDEX_ETF_TICKERS`) if that read is missing
or older than `MARKET_BIAS_MAX_AGE_MS` (15 min). The SPY fetch was wrapped in `within(promise,
2_500)` — the SAME 2.5s budget given to every OTHER per-ticker read fired in the same
`Promise.all`, even though a per-ticker miss only softens ONE setup's score adjustment
(best-effort) while a SPY miss vetoes FIVE major tickers at once for that whole cycle.

### Evidence

Live rejection-export data (`GET /api/admin/zerodte/rejection-export?gate_failed=no_market_bias`,
2026-09-16): **112 total rejections, 94% (105/112) concentrated on exactly QQQ (44) / SPXW (25) /
SPY (26) / DIA (8) / IWM (2)** — the only tickers G-1 even applies to, at real RTH timestamps
(e.g. 16:42, 17:58, 18:32 UTC), not an after-hours artifact.

Live re-run of `scripts/audit/zerodte-gate-compound-funnel.mjs --now-et=11:30` the same day
caught it in the act: QQQ (score 84), SPY (78), SPXW (68), SPX (66) — the four HIGHEST-scoring
setups in the whole pool that pass — were all blocked by `no_market_bias` in the SAME scan pass,
simultaneously.

Traced to `intradayReadFor("SPY", today)` sharing `TICKER_INTRADAY_FETCH_TIMEOUT_MS` (2.5s) with
every other concurrent per-ticker fetch in the batch — a single slow Polygon response (SPY's
minute-bar payload is larger than a single name's, up to 1000 one-minute bars for the day) is
enough to time out and null `bias`/`biasAsOfMs` for the entire cycle.

### Fix

`intradayReadFor` now accepts a `timeoutMs` override (default unchanged, 2.5s). SPY's own read in
`attachIntradayEdge` is called with a new `SPY_BIAS_FETCH_TIMEOUT_MS` (6s) instead — still well
under `MARKET_BIAS_MAX_AGE_MS`'s 15-minute staleness ceiling, so a genuinely stale tape still
fails closed exactly as before. Only the amount of patience given to a single scan cycle's SPY
fetch changed; no gate logic, no staleness bound, no scoring formula touched.

### What was deliberately NOT done

- Did not touch `MARKET_BIAS_MAX_AGE_MS` (the 15-min staleness ceiling) — that's the correctness
  bound; this fix only affects how long one cycle waits before giving up and computing a fresh
  read.
- Did not touch `score_floor` or any other gate identified in the same investigation
  (`zerodte-gate-compound-funnel.mjs` reconfirmed it as the dominant chokepoint for single names
  like TSLA/NVDA) — that's a calibrated, evidence-based floor per its own code comment, not a
  bug, and needs a real backtest before any threshold change, per the standing "measure before
  guessing" discipline.
- Did not widen the per-ticker (non-SPY) timeout — a miss there is low-stakes (one setup's score
  adjustment only) and widening it would only slow every scan cycle for no benefit.

### Test

`src/lib/zerodte/scan.test.ts` — three new regression tests (RED before the fix, verified via
`intradayReadFor(ticker, today)` without the timeout override still returning `null` on a
simulated 4s-slow Polygon response; GREEN after, passing `SPY_BIAS_FETCH_TIMEOUT_MS` explicitly):
1. a per-ticker read still times out fast on a slow response (unchanged default budget stays
   tight — no regression on the low-stakes path)
2. SPY's read survives the identical slow response when given the wider SPY-bias budget
3. SPY given the OLD default budget still reproduces the original bug (proves the fix is the
   timeout override itself, not an incidental change to fetching/caching)

Full suite: 14402 pass / 0 fail / 3 skipped (expected) on Node 20. `tsc --noEmit` clean.
