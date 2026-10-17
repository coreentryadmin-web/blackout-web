> **kind:** FINDING

## Largo `get_earnings` tool result live-truncated — `unusual_whales`/`estimates` merged with zero budget fitting — FIXED

| **Status** | Fixed (`src/lib/largo/market-data-fits.ts`, `src/lib/largo/run-tool.ts`) |
|---|---|

**Found via:** this session's standing Ask Largo deep-dive (5-engine live monitor cycle), a CloudWatch
sweep of `/ecs/blackout-production` for 2026-10-17 11:06-11:36 ET turned up 10 `TRUNCATED` live
tool results, including `get_earnings TRUNCATED 83506/16000` and `90305/16000` — far bigger than
anything `related_news` (already fixed, see the earlier `fitEarningsRelatedNewsForModel` fix and its
own header comment) could produce.

**Root cause.** `run-tool.ts`'s `get_earnings` case (`case "get_earnings"`) merges six fields into
one envelope: `next_report`, `print_history`, `print_history_summary`, `calendar_error`,
`related_news` (already budget-fit), and then `unusual_whales: uw, estimates` — spread in with
**zero fitting at all**. Measured live against the real UW endpoints (2026-10-17):

- `fetchUwEarnings(sym)` (`GET /api/earnings/<ticker>`) returns **every quarter UW has on file**,
  no slice/limit — unlike every sibling UW fetcher in the same file (`fetchUwScreenerStocks`,
  `fetchUwUnusualTrades`, `fetchUwOptionContractFlow` all cap their own result). NVDA returned 107
  rows / ~70.6KB, AAPL ~80.9KB, TSLA ~47.5KB — several times the entire 16k transport cap on this
  ONE field alone. This data is also the **lowest-value** earnings source per the file's own
  precedence comment ("the structured feed is primary... the news channel is not") — it exists
  only as a last-resort `source` label when Benzinga structured+news are both empty, and
  `print_history` (Benzinga, reaction-aware, already capped to 6) already covers the model's real
  need for historical prints.
- `fetchUwEarningsEstimates(sym)` (`GET /api/companies/<ticker>/earnings-estimates`) returns
  `{ ticker, estimates: [...] }`. `extractRows` (`unusual-whales.ts`) cannot unwrap this shape — the
  key `"estimates"` isn't in its recognized-wrapper list (`data`/`flow_alerts`/`alerts`/`body`/
  `results`/`indicators`/`rows`) — so it falls through to the single-row fallback and returns the
  **entire response as one opaque row**. Measured consistently ~16KB regardless of ticker (NVDA
  15.96KB, AAPL 16.07KB, TSLA 16.01KB, META 16.05KB, GOOG 16.12KB) — already over this module's own
  14KB budget (`LARGO_RESULT_CHAR_BUDGET`) on its own.

**Blast radius.** Single tool (`get_earnings`), single call site. `fitEarningsRelatedNewsForModel`
was separately found to always pass `base: {}` to `fitRowsToBudget`, so its own `related_news_truncated`
flag never accounted for the other five fields — not itself the overflow's cause (related_news is
small, ~1-2KB), but dishonest telemetry once the real culprits are fixed, so corrected in the same
pass.

**Fix.** Added two new fit functions to `market-data-fits.ts` (`fitEarningsUwHistoryForModel`,
`fitEarningsEstimatesForModel`), both using the existing `fitRowsToBudget` primitive. `run-tool.ts`
now threads a single growing `base` object through all three fits in sequence — scalars first,
then `related_news`, then `unusual_whales`, then `estimates` — so the FINAL merged envelope can
never exceed budget regardless of which field is the big one for a given ticker.
`fitEarningsRelatedNewsForModel` gained an optional third `base` parameter (default `{}`, so every
existing call/test is unaffected) so its own truncation accounting is now honest about room already
consumed by the fields decided before it.

**Why `estimates` can only be all-or-nothing.** Since `extractRows` wraps the whole UW estimates
response as one indivisible row, `fitEarningsEstimatesForModel` can't partially shrink it — but
budget-fitting it is still real protection: if the fields decided before it already consumed the
budget, it now drops the whole thing with an honest `estimates_truncated: true` instead of silently
blowing the 16k transport cap (which just discards the TAIL of the JSON, corrupting everything after
it, including the aggregates the earlier fields carry).

**Tests.** `src/lib/largo/market-data-fits.test.ts` — 5 new tests: a sanity reproduction proving the
pre-fix unconditional-merge shape (equivalent measured fixture sizes) exceeds the transport cap;
`fitEarningsUwHistoryForModel` stays under budget at the measured 107-row size and a larger one;
`fitEarningsEstimatesForModel` drops the estimates blob when the base already consumed the budget
and keeps it when there's room; and a full sequential-fit end-to-end test at full measured
real-world sizes. Confirmed RED (4 of 5 new tests fail on missing exports) against unmodified
source via `git stash`, GREEN after the fix. Full `src/lib/largo` suite: 1349/1349 pass.
