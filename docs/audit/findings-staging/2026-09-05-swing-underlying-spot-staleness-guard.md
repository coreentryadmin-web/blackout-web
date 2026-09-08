# 2026-09-05 — Swing structural-stop fed by a stale-but-200-OK underlying spot (deep-dive Q38)

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Area** | `swing-active-refresh` cron — the underlying-spot read that feeds `structuralStopBroken` |
| **Status** | FIXED |

## Symptom

`loadUnderlyingSpot` (`src/app/api/cron/swing-active-refresh/route.ts`) trusted ANY finite positive
`.p` from Polygon's `/v2/last/trade/{ticker}` as the live spot for that tick, with no check on the
trade's own timestamp. That spot feeds directly into `structuralStopBroken` (`src/lib/swing/manage.ts`),
the single highest-precedence GATE rung — it fires a full real-money `EXIT` "at ANY premium P&L"
regardless of every other consideration.

## Root cause

A hard Polygon outage already fails closed (the fetch throws/returns an invalid shape → `p` is not
finite → `loadUnderlyingSpot` returns `null` → the position is correctly skipped for that tick, per
the existing `if (spot == null) return null;` fail-soft path). But a feed that stays UP and keeps
returning HTTP 200 with an OLD cached last-trade — rather than erroring — is indistinguishable from a
genuinely live read under a "finite and positive" check alone. Concretely: Polygon degrades for a
single name mid-session while the real underlying has since moved back above a LONG position's
structural stop; the cron reads the stale sub-stop price every 15 minutes for hours and fires a real
EXIT on a thesis that was never actually broken — an inverse failure mode from a hard outage, and one
the existing fail-closed path could not see because nothing was late and nothing errored.

## Fix

Extracted a pure, unit-tested `spotFromLastTradeResult(trade, now, staleMs)` helper
(`src/lib/swing/underlying-spot-freshness.ts`) that also validates the trade's own SIP timestamp
(Polygon's `t` field, nanoseconds — verified live against `/v2/last/trade/NVDA`) via the shared
`isWsUpdatedAtFresh` helper already used across the day's freshness-guard fixes. A trade older than
`SWING_UNDERLYING_TRADE_STALE_MS` (15 minutes — one full active-refresh cron interval; the cron only
fires during RTH, so any actively-held position with a real options market should always show a
trade newer than one cycle) now reads as `null`, routing through the exact same existing
fail-soft/skip path as a hard outage — no new code path, no new failure mode, just closing the gap
between "the feed errored" and "the feed is silently serving a stale tape."

`loadUnderlyingSpot` is now a thin wrapper: `fetchStockLastTrade(ticker)` → `spotFromLastTradeResult(trade)`.

## Blast radius

`swing-discovery/route.ts:409-412` reads `fetchStockLastTrade(...).p` the same way (no timestamp
check) for CANDIDATE pricing at discovery time — same provider pattern, but it does not feed a
committed position's unconditional EXIT gate (worst case is a slightly mispriced candidate score, not
a false real-money exit), so it was deliberately left out of this fix to keep this PR single-issue.
Flagged here as a lower-severity sibling instance worth a follow-up if it's ever found to matter in
practice.

## Evidence

- New `src/lib/swing/underlying-spot-freshness.test.ts` (9 cases) — RED→GREEN proven: reverted the
  module to the old "trust any finite positive price" behavior and confirmed 4 of the 9 tests fail
  with a real assertion mismatch (including the exact Q38 scenario — a stale-but-200-OK trade
  wrongly returning the stale price instead of `null`), then restored and confirmed 9/9 pass.
- `npx tsc --noEmit` — clean.
- Full `npm test` — 12640 pass / 0 fail / 3 skipped (pre-existing skips, unrelated).

## RTH validation

- During RTH, spot-check `swing-active-refresh` CloudWatch logs for any position whose skip reason
  would newly read as "no usable underlying read" where it previously would have recorded a snapshot
  — that's this guard actually firing, and it should be rare (only on genuine feed degradation).
- Confirm no currently-open real swing position gets an unexpected `structural_stop` EXIT that
  doesn't line up with the ticker's actual live tape on a public chart at the same timestamp.
