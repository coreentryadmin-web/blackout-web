# 2026-09-05 — Largo quote change_pct rebase + market health roundFloats

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Area** | Largo `get_quote` tool, admin `/api/market/health` |
| **Status** | FIXED |

## Symptom

1. Largo `toolQuote()` returned raw WS `candle.changePct` for stocks while `/api/market/quote` rebases off the REST snapshot — Largo could quote a live price beside a session-open–anchored day-change.
2. `/api/market/health` returned `buildMarketHealthSnapshot()` without `roundFloats`, so admin System Vitals could show IEEE float tails on prices/ages.

## Root cause

- `toolQuote` stock WS path was added before the quote-route rebase contract and never enrolled in the same `withFreshPrice` guard.
- Health route predates the repo-wide "round at API boundary" policy.

## Fix

- Stock WS path: `fetchStockSnapshot` + `withFreshPrice` before returning `change_pct`.
- Health route: wrap snapshot with `roundFloats` at `NextResponse.json`.

## Evidence

- `run-tool-quote-change.test.ts` — rebase source scan.
- `market/health/route.test.ts` — roundFloats source scan.

## RTH validation

- Ask Largo for a fast-moving ticker quote during RTH; `change_pct` should agree with `/api/market/quote?ticker=...` directionally.
- Admin → System Vitals: no long float tails on index prices.
