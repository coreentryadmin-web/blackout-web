> **kind:** FINDING

## 2026-08-27 — [FINDING, P3 audit tooling] `data-validator.mjs`'s single-name 0DTE underlying_price check used stale prev-close as "ground truth" during extended hours — false FAILs on real earnings moves — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P3 — audit-tooling correctness only; no member-facing code touched, but a false-FAIL here wastes coordinator time chasing a phantom bug and, worse, teaches the fleet to distrust (or ignore) this check |

**Symptom.** A live run of `npm run` (`node --import tsx scripts/audit/data-validator.mjs`)
during today's extended-hours session reported 4 FAILs:

```
[FAIL] 0DTE live CRM: underlying_price vs Polygon — app=252.19 polygon(prev-close)=205.62 Δ=22.649%
[FAIL] 0DTE live MRVL: underlying_price vs Polygon — app=222.77 polygon(prev-close)=245.11 Δ=9.114%
[FAIL] 0DTE live MSTR: underlying_price vs Polygon — app=139 polygon(prev-close)=123.19 Δ=12.834%
[FAIL] 0DTE live TSLA: underlying_price vs Polygon — app=354.51 polygon(prev-close)=345.82 Δ=2.513%
```

**Root cause.** `polygonSpotNow(ticker, isRth)` gates its ENTIRE ground-truth strategy on
`isRth` (`pStatus.market === 'open'`): during RTH it fetches a live Polygon snapshot;
otherwise — for BOTH a fully closed market AND an active extended-hours session — it falls
back to yesterday's close. That conflates two very different states. SPX (a pure index)
genuinely has no extended-hours quotes, so prev-close is the right fallback there. But
single-name stocks/ETFs DO trade pre/post-market, and Polygon's own snapshot `lastTrade`
reflects it — the fallback was needlessly discarding a real, available live price and
comparing the app's current 0DTE board price against a stale yesterday's-close instead.

Fetched a live last-trade quote directly to confirm: CRM $252.06, MRVL $223.20, MSTR
$139.18, TSLA $354.53 — all within 0.3% of what the app was already showing. The app was
correct; the validator's own ground truth was the stale one.

**Evidence.** Live re-run after the fix, same session: all 4 previously-failing checks now
read `polygon(live)` (not `prev-close`) and PASS at 0.03–0.32% Δ — `TOTALS
{"PASS":53,"INFO":5}` vs the prior run's `{"PASS":49,"INFO":5,"FAIL":4}`.

**Blast radius.** `polygonSpotNow` has exactly one call site (the 0DTE live-setups
underlying-price check). The SPY/SPX/VIX top-level ground-truth block (lines ~411-429,
also `isRth`-gated) is a SEPARATE code path with the same theoretical exposure — SPY is an
ETF that also trades extended hours — but was NOT touched here: it didn't fail this run
(VIX's off-hours %Δ happened to clear its wider index tolerance), and widening scope to a
second, currently-passing code path in the same PR would blur what this fix is proven to
fix. Flagged as a candidate follow-up, not fixed blind.

**Fix.** `polygonSpotNow` now always tries the live snapshot for stock/ETF tickers
(regardless of `isRth`), falling back to prev-close only when the snapshot has no usable
price (fully closed market, or an illiquid name with no extended print at all). Returns
`{ value, source }` so the PASS/FAIL log line's `polygon(live|prev-close)` label is now
always accurate instead of assumed from `isRth`. SPX's index-only branch is untouched and
stays `isRth`-gated, since it has no extended-hours quote to fall back to.

**Fix rationale.** Minimal, single-call-site change. Did not touch the single-name
tolerance widening (`nameTol`, 1.5% RTH / 2.5% off-hours) — that widening exists for a
different, still-valid reason (the app's `underlying_price` is flow-derived and can lag a
truly-live quote between UW flow bursts on sparse-flow names), unrelated to which ground-
truth SOURCE this fix corrects.

**Regression guard.** No unit test added — this file has no companion `.test.mjs` (it is a
live-network-only validation instrument, consistent with every other script in
`scripts/audit/`, several of which document the same "verified by re-running live" pattern
rather than a mock-based test). Verified instead by the live re-run above, matching this
file's own established practice (e.g. the SPXW `underlying_ticker` fix documented in the
comment just above `polygonSpotNow`).
