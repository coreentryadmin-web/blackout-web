> **kind:** FINDING

## Largo cross-product read: Night Hawk's vote was never actually about the ticker being asked about — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Lane** | 0DTE / Night Hawk deep-dive (Largo product contract compliance) |
| **Severity** | P1 (a Largo-facing tool silently answered the wrong question — real member-facing wrong-answer risk) |
| **Files** | `src/lib/largo/contract/product-adapters.ts` (`nighthawkContribution`), `src/lib/largo/contract/cross-product-read.ts` |
| **Found by** | Open-ended 0DTE engine audit (operator-requested deep dive), 2026-09-17 |

### Root cause

`crossProductRead(ticker, ...)` (`cross-product-read.ts`) fans out to six product tools and joins
their answers into one "does everyone agree on this ticker" read (`docs/audit/LARGO-PRODUCT-CONTRACT.md`'s
"identity" point: every product read must be about the ticker actually queried). Five of the six
tools take the ticker as an input and their adapters trust the tool already scoped the answer.
Night Hawk's tool, `get_zerodte_plays`, is different: it always returns the **whole multi-ticker
0DTE board** (`SOURCES` entry: `input: () => ({})` — no ticker is ever passed to the tool), because
that tool exists to answer "what is the 0DTE desk doing today", not "what is it doing on ticker X".

`nighthawkContribution` never accounted for that difference. It counted calls vs. puts across
**every** committed play on the whole board (up to 10, regardless of ticker) and reported the
aggregate as if it were a read of the one ticker the cross-product question was actually about.
Concretely: asking Largo "does everyone agree on TSLA" when TSLA has no 0DTE play today, but SPX/
NVDA/QQQ do, still produced a confident `bullish`/`bearish`/`neutral` "Night Hawk" vote sourced
entirely from those unrelated tickers — a vote that could align with or contradict Helix/Vector's
real TSLA reads for reasons that had nothing to do with TSLA.

It compounded the mislabeling: the signal's own `ticker` field was set from `p.ticker`, a field the
real `get_zerodte_plays` payload never carries at the top level (there is no single ticker on a
whole-board response — only a `plays: [...]` array, each play carrying its own ticker). So in
production every Night Hawk signal silently carried `ticker: ""`. This is the exact "hardcoded
ticker_class" shape a prior fix in the same file already caught and corrected for helix/vector
(see the comment above `tickerClassFor`) — it was never closed here because it manifests as an
always-empty string rather than an always-wrong constant, so it never showed up as an obviously
wrong value in a spot check.

The existing regression test (`product-adapters.test.ts`, "night hawk votes from what the desk
actually committed") actually *encoded* the bug: it built a payload with SPX+NVDA+QQQ plays and
asserted the aggregate direction, treating "borrow every other ticker's committed play into one
ticker's vote" as correct behavior.

### Evidence

RED before the fix (`git stash` proof, `npx tsx --experimental-test-module-mocks --test
product-adapters.test.ts`): 2 failures —
- `nighthawkEquity.signal?.ticker_class` mismatch (signal's `ticker` was `""`, so
  `tickerClassFor("")` never resolved to `"equity"` for a queried TSLA).
- the new identity regression test: querying `TSLA` against a board holding only SPX/NVDA/QQQ
  plays returned a non-null `bullish`/`bearish` signal instead of an honest absence, and querying
  `NVDA` against a board where NVDA itself is a lone call (plus two unrelated SPX puts) returned
  `bearish` instead of `bullish`.

GREEN after: 33/33 pass in `product-adapters.test.ts` + `cross-product-read.test.ts` +
`cross-product.test.ts`; `npx tsc --noEmit` clean; full `npm test` on Node 20 green (see PR).

### Fix

`nighthawkContribution(payload, queriedTicker)` now takes the queried ticker (mirroring the
`spxContribution(payload, queriedTicker)` shape that already existed in the same file), filters
`plays` down to rows whose own `ticker` matches the one being asked about, and votes **only** off
those. No committed play for that ticker is now an honest, explained absence
(`missingReason: "no committed 0DTE play on <TICKER> this session"`), never a borrowed board-wide
vote. `cross-product-read.ts`'s join loop special-cases `nighthawk` exactly the way it already
special-cased `spx`, so the ticker actually threads through.

### Blast radius

Only one call site outside tests (`cross-product-read.ts`'s `SOURCES` fan-out) and it is the only
production consumer of `nighthawkContribution`. No other adapter shares this bug — every other
adapter's underlying tool already takes `ticker` as an input and is scoped by the tool itself
(confirmed by reading each one during this pass); Night Hawk was the one tool whose contract is
"whole board, no ticker filter", which is exactly why this identity gap could exist here and
nowhere else.

### Fix rationale — what was deliberately left unchanged

- Did not add ticker-filtering to `get_zerodte_plays` itself — that tool intentionally answers
  "board state", and other callers (system prompt guidance, `zeroDtePlaysForLargo` consumers) rely
  on the whole-board shape. The fix belongs at the adapter boundary, where the cross-product join's
  contract (one ticker) meets the tool's contract (whole board) — same shape as `spxContribution`'s
  own SPX/SPXW scoping already living in the adapter, not in the SPX tool.
- Deliberately did NOT also change how a CONDOR play's `direction` field is voted on once matched
  to the queried ticker (it is still counted as a directional call/put vote) — condor.ts's own doc
  says that field is "UNUSED by the neutral structure's gates/grader" (nominal fade-side provenance
  only for a delta-neutral 4-leg structure), so a condor row voting directionally in this
  cross-product read may itself be a second, narrower issue. Left out of this PR to keep it
  single-issue; raised as a follow-up idea in this session's report instead.
