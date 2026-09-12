> **kind:** FINDING

# Night Hawk record/funnel window drifts by a day near UTC midnight (~8pm–midnight ET) — FIXED

| Field | Detail |
|---|---|
| **Status** | FIXED |
| **Lane** | Night Hawk Legacy |
| **Severity** | P2 — member-visible track-record numbers (win rate, resolved count) and the admin funnel dashboard silently shift with no underlying data change, for several hours every trading evening |
| **Files** | `src/lib/db.ts` — `fetchNighthawkOutcomeAnalytics`, `fetchNighthawkFunnelStats` |
| **PR** | (opened same session as this finding) |

## Root cause

`fetchNighthawkOutcomeAnalytics` (backing `GET /api/market/nighthawk/record`) and
`fetchNighthawkFunnelStats` (backing the admin Night Hawk funnel dashboard) both windowed their
`edition_for` cutoff with bare Postgres `CURRENT_DATE`:

```sql
WHERE o.edition_for >= (CURRENT_DATE - ($1::int || ' days')::interval)
```

`CURRENT_DATE` resolves in the **DB session's timezone** — UTC on this stack; nothing in `db.ts`
issues a `SET TIME ZONE`. `edition_for` is an **ET trading-day date** (every edition is keyed by
`nextTradingDayEt`/`todayEtYmd`, ET calendar days throughout the rest of the app). Between ~8pm and
midnight ET, `CURRENT_DATE` (UTC) has already ticked over to the *next* calendar day while it is
still the current ET trading day — so the computed cutoff (`CURRENT_DATE - N days`) is one day
later than intended, and the oldest ET trading day silently rolls out of the window early.

This is not a new class of bug in this codebase — `db.ts` already documents and fixes the identical
mistake a few thousand lines earlier, in the flow-alerts DTE query: *"DTE against the ET calendar
date (not UTC CURRENT_DATE) so labels match the rest of the app and don't go off-by-one/negative in
the 8pm–midnight ET window."* That fix (`(NOW() AT TIME ZONE 'America/New_York')::date`) was never
applied to these two Night Hawk functions.

## Evidence

Live-observed during the standing 15-minute Legacy audit cadence, 2026-09-11/12:
- 23:51 UTC cycle (`?days=14`): `segments.current.resolved` = **30**.
- 00:07 UTC cycle, ~16 minutes later, no market activity in between (Friday evening, RTH long
  closed): `segments.current.resolved` = **26**.

The drop landed exactly at the UTC-midnight boundary — the only event that occurred between the two
reads. `CURRENT_DATE` ticked from 2026-09-11 to 2026-09-12 (UTC), shifting the 14-day cutoff from
`2026-08-28` to `2026-08-29` and dropping every `edition_for = 2026-08-28` row from the window,
although in ET (~7:51pm and ~8:07pm EDT respectively) it was the same trading evening throughout.

## Fix

Anchor both functions' cutoff to the ET calendar date, matching the existing pattern:

```sql
WHERE o.edition_for >= ((NOW() AT TIME ZONE 'America/New_York')::date - ($1::int || ' days')::interval)
```

Applied at all three call sites: `fetchNighthawkOutcomeAnalytics`'s single `edition_for` filter, and
both of `fetchNighthawkFunnelStats`'s filters (published-side `nighthawk_play_outcomes.edition_for`
and rejected-side `alert_audit_log.source_key->>'edition_for'`) — the funnel function's own doc
comment states it "windows the same way `fetchNighthawkOutcomeAnalytics` windows its own edition_for
query, so both sides of the funnel line up over the identical date range," so all three needed the
identical fix to keep that invariant.

## Blast radius

- `GET /api/market/nighthawk/record` — member-visible win rate, resolved count, segments (current +
  legacy), avg return — all computed from `fetchNighthawkOutcomeAnalytics`'s row set.
- Admin Night Hawk funnel/rejection-rate dashboard — `fetchNighthawkFunnelStats`.
- No other caller of either function exists (both are Legacy/Night-Hawk-record-specific; 0DTE and
  Swings use their own separate ledger/commit tables and functions).

## Fix rationale

Chose the exact fix pattern already established and proven correct elsewhere in the same file
(`(NOW() AT TIME ZONE 'America/New_York')::date`) rather than inventing a new approach, so the
codebase has one consistent idiom for "today, in ET" at the SQL layer. Left the `$1::int` safe-int
coercion and the interval arithmetic shape untouched — only the anchor changed.

## Regression test

`src/lib/db.test.ts` — two new source-inspection tests (DB-integration testing isn't available in
this sandbox; raw Postgres TCP is blocked). Each extracts the target function's body from `db.ts`
and asserts it contains no bare `CURRENT_DATE` token and does contain the ET-anchored expression
(the funnel test asserts exactly 2 occurrences, one per filter). Verified RED against the pre-fix
source (both failed with the old `CURRENT_DATE` clause quoted back in the assertion output), then
GREEN after the fix (32/32 in the file, `tsc --noEmit` clean).
