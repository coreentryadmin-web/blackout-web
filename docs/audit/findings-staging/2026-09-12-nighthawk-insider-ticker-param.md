> **kind:** FINDING

# `fetchUwInsiderTransactions` sent the wrong query-param name — every ticker's "insider activity" was really a random other ticker's

| | |
|---|---|
| **Status** | FIXED |
| **Surface** | `fetchUwInsiderTransactions` (`src/lib/providers/unusual-whales.ts`), consumed by Night Hawk's shared dossier builder (`dossier.ts`, feeds Legacy + edition scoring's `insider_buys`) and Largo's `get_insider_flow` tool (`run-tool.ts`) |
| **Severity** | P1 — silently returned a DIFFERENT ticker's data for every single call; no error, no crash, no visible symptom |

## Root cause

`fetchUwInsiderTransactions(ticker, limit)` called `/api/insider/transactions` with a `ticker`
query param. Live-pulled the real endpoint before touching any code:

```
GET /api/insider/transactions?ticker=AAPL&limit=5
-> tickers returned: FSLY, FSLY, GETY, DBX, ULTA        (NOT AAPL)
```

Tried every plausible alternate spelling — `symbol`, `symbols`, `tickers`, `ticker_symbols` — all
silently ignored the same way (same unfiltered market-wide feed back every time, no 400/422). The
**real** filter param is `ticker_symbol` (singular, with underscore before "symbol"):

```
GET /api/insider/transactions?ticker_symbol=AAPL&limit=5
-> tickers returned: AAPL, AAPL, AAPL, AAPL, AAPL        (correct)
```

Because the wrong param was silently accepted (HTTP 200, well-formed JSON) rather than rejected,
this was invisible to every existing consumer: the call "succeeded," returned a plausible-looking
array of real insider-transaction rows, and nothing about the response shape signaled that the
`ticker` filter had done nothing. Every caller was reading the SAME market-wide most-recent-filings
feed regardless of which ticker it asked for — the exact opposite of what the function's name and
every caller's usage promises.

## Blast radius

- **`dossier.ts`** (Night Hawk's shared dossier builder, feeds Legacy's overnight digest scoring
  AND `edition-builder.ts`): `insider_buys` was computed via
  `insiderRows.filter(isRecentInsiderBuy).length` over this market-wide, unfiltered feed — so
  `insider_buys` was IDENTICAL across every ticker's dossier built in the same cache window (the
  underlying data literally does not vary by `sym`), not a genuine per-ticker signal at all. This
  feeds `scorer.ts`'s `+2 bullish if (dossier.insider_buys ?? 0) > 0` bonus and
  `hunt-builder.ts`'s `dossier.insider_buys > 0` eligibility gate — both were reading market noise
  shared identically across the whole universe, not this ticker's own insider activity.
- **`run-tool.ts`**'s `get_insider_flow` Largo tool (`case "get_insider_flow"`): returns
  `{ aggregate: fetchUwInsiderFlow(sym), transactions: fetchUwInsiderTransactions(sym) }` directly
  to the model. The `aggregate` half (a different, correctly ticker-scoped endpoint,
  `/api/stock/{ticker}/insider-buy-sells`) was fine; the `transactions` half was a random other
  ticker's transactions presented to Largo as if they belonged to the ticker asked about — a
  direct Largo-answer-correctness defect (falls under the standing Ask Largo ownership mandate,
  not just the Legacy scoring path).

## Fix

Changed the query param from `ticker` to `ticker_symbol` in `fetchUwInsiderTransactions` — the
minimal, single-line root-cause fix; every consumer (`dossier.ts`, `run-tool.ts`) needed no changes
since the function's return contract (an array of that ticker's own transaction rows) is now
actually true instead of only nominally true.

Added a regression test (`unusual-whales.test.ts`) that mocks `fetch` and pins the outgoing
request: asserts `ticker_symbol` is present and set correctly, and that the old, silently-ignored
`ticker` param is NOT sent — so a future accidental revert back to the wrong name fails loudly in
CI instead of silently re-mixing every ticker's insider read with a random other one's.

## Why this fix, not an alternative

Considered switching the caller(s) to a different endpoint entirely
(`fetchUwInsiderTicker` → `/api/insider/{ticker}`, or `fetchUwInsiderFlow` →
`/api/stock/{ticker}/insider-buy-sells`) — checked both live first. `/api/insider/{ticker}`
returns insider PROFILES (`name`, `cik`, `is_person`, `social_links` — a roster of people, no
transaction/date/amount fields at all), not transactions, so it cannot serve this function's
contract. `/api/stock/{ticker}/insider-buy-sells` (`fetchUwInsiderFlow`) returns a real,
correctly-ticker-scoped daily purchases/sells aggregate, but it's a DIFFERENT shape
(`{purchases, purchases_notional, sells, sells_notional, filing_date}`, one row per filing day)
that `run-tool.ts`'s `get_insider_flow` tool already separately fetches and returns as its
`aggregate` field — collapsing the two would lose the individual-transaction detail
(`owner_name`, `officer_title`, `transaction_code`, `shares_owned_before/after`) that Largo answers
about "who bought/sold and how much" need. Fixing the one wrong query-param character is the
smallest change that makes the existing, otherwise-correct function do what its name and every
caller already assumed it did.

## Evidence

- Live UW pulls (`UW_API_KEY` from env) proving: (a) `ticker`/`symbol`/`symbols`/`tickers`/
  `ticker_symbols` are all silently ignored on `/api/insider/transactions`, returning the same
  unfiltered feed for every spelling tried; (b) `ticker_symbol=AAPL` correctly returns only AAPL
  rows; (c) the two alternate endpoints' real shapes (`/api/insider/{ticker}` = profiles, no
  transaction fields; `/api/stock/{ticker}/insider-buy-sells` = correctly-scoped daily aggregate).
- RED: stashed the fix in `unusual-whales.ts`, ran the new test — `AssertionError: null !== 'AAPL'`
  (no `ticker_symbol` param sent).
- GREEN: restored the fix — test passes, and asserts the old `ticker` param is absent too.
- `npx tsc --noEmit`: clean.
- Full suite (`npm test`, Node 20): 13915 pass / 0 fail / 3 skipped.

## What was deliberately left unchanged

`isRecentInsiderBuy`'s own date-field fallback chain (`parseTradeDate` in `dossier.ts`, which also
governs `getEditionCongressTrades`'s recency window) still doesn't check `filing_date`/
`filed_at_date` — the real disclosure-date fields for insider and congress rows respectively (the
same "trade date vs. disclosure date" class of bug already fixed once this session in
`congressTradeDecayMultiplier`, #4844). That is a second, independent root cause discovered while
investigating this one, not yet fixed — left for a dedicated follow-up finding/PR rather than
folded into this single-issue fix, per the standing small-PR discipline.
