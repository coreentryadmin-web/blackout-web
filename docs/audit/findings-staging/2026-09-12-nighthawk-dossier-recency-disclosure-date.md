> **kind:** FINDING

# Night Hawk dossier's recency window measured congress/insider rows by TRADE date, not DISCLOSURE date

| | |
|---|---|
| **Status** | FIXED |
| **Surface** | `parseTradeDate`/`isWithinRecentSignalWindow` (`src/features/nighthawk/lib/dossier.ts`) — governs `getEditionCongressTrades`'s recency filter and `isRecentInsiderBuy`'s window check |
| **Severity** | P2 — a real congress trade or insider buy disclosed today could be wrongly dropped as "stale" (or a stale one wrongly kept), no crash, no visible symptom |

## Root cause

`parseTradeDate`'s fallback chain read `filed_at`, `filed_date`, `transaction_date`,
`transactionDate`, `disclosure_date`, `report_date`, `date`, `created_at` — none of which match
the REAL field names on the two row shapes this function actually receives. Live-pulled both:

- Real UW congress rows (`fetchUwCongressTrades`) carry `filed_at_date` (the STOCK Act disclosure
  date — confirmed in this session's earlier `congressTradeDecayMultiplier` fix, #4844) alongside
  `transaction_date` (the trade date itself). Congress members can legally disclose up to 45 days
  after the trade.
- Real UW insider-transaction rows (`fetchUwInsiderTransactions`, just fixed for its own
  ticker-filter bug in #4860) carry `filing_date` (the SEC filing/disclosure date) alongside
  `transaction_date` (the trade date) — same disclosure-vs-trade gap, smaller in typical magnitude
  (Form 4: 2 business days) but the same class.

Neither `filed_at_date` nor `filing_date` was in the chain — only `transaction_date` matched (via
its 3rd-priority fallback slot), so every recency decision in this function was silently measuring
staleness from the TRADE date instead of the DISCLOSURE date. A trade executed 40 days ago but
just disclosed today reads as stale and gets dropped from the window; conversely a trade disclosed
long ago but executed within 30 days (rare, but possible with amended filings) would be wrongly
kept. This is the exact same root-cause class already fixed once this session in
`congressTradeDecayMultiplier` (`scorer.ts`, #4844) — that fix addressed how a kept row's weight
DECAYS; this one is the blast-radius instance governing whether the row is even KEPT in the window
at all, in a different file.

## Blast radius

- **`getEditionCongressTrades`** (`dossier.ts`): filters `cache.congress` to the requested
  ticker's rows within the last `RECENT_SIGNAL_DAYS` (30) via `isWithinRecentSignalWindow` —
  directly gated by this bug. A congress trade disclosed within the last 30 days but executed
  31-45 days ago was being silently excluded from the dossier's `congress_trades` array (and
  therefore invisible to `hunt-builder.ts`'s `dossierHasCatalyst` catalyst check and any
  downstream congress-trade narrative).
- **`isRecentInsiderBuy`** (`dossier.ts`): same window check gates whether an insider transaction
  row counts toward `insider_buys`. A buy filed within 30 days but transacted slightly earlier
  could be dropped from the count.

## Fix

Added `row.filed_at_date` and `row.filing_date` as the first two checks in `parseTradeDate`'s
fallback chain (every existing fallback kept afterward, unchanged) — the disclosure date, which is
the field that actually determines whether the market/an analyst could have known about the trade
"recently," takes priority over the trade date.

Also exported `parseTradeDate` and `isWithinRecentSignalWindow` (both were module-private) so a
regression test could exercise them directly — the smallest surface change that makes the fix
testable without spinning up the full `fetchTickerDossier` fetch pipeline.

Added `dossier.test.ts` (new file — none existed for this module) with 5 regression tests using
the real congress and insider row shapes, proving the disclosure date wins over the trade date in
both the direct `parseTradeDate` output and the derived `isWithinRecentSignalWindow` boolean, plus
a test proving the existing `transaction_date`-only fallback still works when no disclosure-date
field is present.

## Why this fix, not an alternative

Considered giving congress and insider rows separate, source-specific date-parsing functions
instead of one shared fallback chain, since they're conceptually different row shapes. Kept the
single shared `parseTradeDate` because both call sites already used it, both `filed_at_date` and
`filing_date` are unambiguous field names that will never collide with the other source's real
fields, and splitting it would be unrelated scope creep on a fix that only needed two more field
names added to an existing, working fallback pattern already used elsewhere in this file.

## Evidence

- Live UW pulls (real `UW_API_KEY`, same session as #4844/#4860) confirming `filed_at_date` on
  congress rows and `filing_date` on insider-transaction rows.
- RED: stashed the fix, ran the new `dossier.test.ts` — 5/5 fail (disclosure-date fields not
  checked, so recency fell back to the stale trade date every time).
- GREEN: restored the fix — 5/5 pass, including the fallback-still-works test.
- `npx tsc --noEmit`: clean.
- Full suite (`npm test`, Node 20): 13921 pass / 0 fail / 3 skipped.

## What was deliberately left unchanged

`isRecentInsiderBuy`'s buy/sell classification logic (`transaction_code`/`type`/`buy_sell` field
checks) is untouched — those fields were already correct for the real per-ticker transaction rows
(confirmed live when auditing #4860); only the recency-window date field was wrong.
