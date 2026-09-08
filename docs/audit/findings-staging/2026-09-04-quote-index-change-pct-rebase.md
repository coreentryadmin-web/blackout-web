# Quote route index WS change_pct rebase — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Severity** | P1 |
| **Area** | `/api/market/quote` Thermal header tape |
| **PR** | (pending) |

## Symptom

Thermal GEX header polls `/api/market/quote?ticker=SPX` every ~1.5s. The index WS fast path served `indexStore[root].change_pct` raw — session-open–anchored when `open_source === "ws-bar"` (mid-session ECS cold start). Stock path already rebased via `withFreshPrice`; `indices/route` and `spx-desk` use `overlayRestIndexWithWs`.

## Root cause

`route.ts` lines ~196–203 returned WS `change_pct` without checking `open_source` or rebasing against REST prior close.

## Fix

`buildIndexWsQuote()` overlays live WS price on shared REST quote cache (or one coalesced `getRestQuote` fetch) via `overlayRestIndexWithWs`. When no REST baseline exists, only trust WS change when `open_source === "rest"`; else emit `null` (honest unknown).

## Evidence

- `route-guards.test.ts` — structural guard for `overlayRestIndexWithWs` + `open_source` check
- `index-snapshot-overlay.test.ts` — VIX ws-bar rebase regression (existing)
