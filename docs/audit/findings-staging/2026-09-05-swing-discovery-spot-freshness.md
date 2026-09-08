# 2026-09-05 — Swing discovery WATCH spot refresh trusted stale-but-200-OK last trades (#3893 sibling)

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Area** | `swing-discovery` cron — live last-trade spot refresh for WATCH setup-maturity |
| **Status** | FIXED |

## Symptom

During RTH, `swing-discovery` refreshes underlying spots for persistence-cleared WATCH names via
`fetchStockLastTrade` and trusted any finite positive `.p` with no timestamp check
(`route.ts:409-411`). A degraded feed returning HTTP 200 with an old cached last-trade could
overwrite the plan-entry fallback with a stale price, skewing FORMING/TRIGGERED/EXTENDED
setup-maturity flags on the member serving snapshot.

## Root cause

Same bug class as #3893 (`underlying-spot-freshness.ts`): finite-positive price without SIP
timestamp validation. Lower severity than active-refresh because this path feeds setup-maturity
display logic, not the unconditional `structural_stop` EXIT gate — but still violates the
"every user-visible value is live, correct, and grounded" rule.

## Fix

Route WATCH spot refresh through the shared `spotFromLastTradeResult()` helper (already unit-tested
in `underlying-spot-freshness.test.ts`). Stale trades return `null` and the existing fail-soft path
keeps the plan-entry fallback.

## Evidence

- `npx tsc --noEmit` — clean.
- `npx tsx --test src/lib/swing/underlying-spot-freshness.test.ts` — 9/9 pass (helper coverage).

## RTH validation

- During a swing-discovery scan with WATCH names, confirm `spotsByTicker` for refreshed tickers
  tracks live tape (not a price from hours earlier) on `/swings` setup-maturity chips.
- On genuine single-name feed degradation, WATCH names should keep plan-entry fallback spots rather
  than showing a stale live refresh.
