# Stock SSE change_pct ws-bar authority gate — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Severity** | P1 |
| **Area** | Thermal / stock spot SSE / quote coherence |
| **PR** | (pending) |

## Symptom

Stock tickers on the Thermal header tape and `/api/market/stocks/spot-stream` SSE path served `changePct` computed from the first WS bar's open (`openSource === "ws-bar"`) — session-open–anchored drift, not true day change vs prior close. On a mid-session reconnect or before the REST `prev_close` seed landed, NVDA could show +2.5% from boot price while `/api/market/quote` (when REST cache hot) showed the correct prior-close %.

## Root cause

`getStockLiveCandle()` always returned `computeChangePct(close, sessionOpen)` even when `openSource !== "rest"`. `buildSpotFrame()` forwarded that value verbatim to SSE clients. Index/SPX paths already gate on `open_source === "rest"` (FIX-A); stocks did not on the push path.

## Fix

- `authoritativeStockChangePct()` — returns `null` unless `openSource === "rest"`.
- `getStockLiveCandle()` / Redis snapshots carry `openSource`; member-facing `changePct` is null until REST anchor lands.
- Stale/empty paths return `changePct: null` (not fabricated `0`).

## Evidence

- `src/lib/ws/stock-candle-store.test.ts` — ws-bar → null; REST seed → 5.00%.
- `src/lib/ws/stocks-spot-stream-hub.test.ts` — SSE frame omits % until authoritative.

## RTH validation

On Thermal `/heatmap` with a stock preset (e.g. NVDA) at RTH open: header change % should appear within ~30s of first load (REST seed), and must match `/api/market/quote?ticker=NVDA` change_pct once both are live.
