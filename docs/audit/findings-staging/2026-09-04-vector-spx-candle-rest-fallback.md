# Vector SPX SSE candle null at RTH open — REST fallback gap — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Symptom** | `vector-e2e-audit.mjs` FAIL `api:vector-stream-payload: candle null during RTH` at 09:30 ET Fri 2026-09-04; walls/gamma flip present, `candle.close` missing on first SSE frames. |
| **Root cause** | `getVectorLiveCandle("SPX")` returned only `getCurrentSpxCandle()` (WS + Redis) with no REST snapshot fallback. Non-SPX tickers already call `getRestFallbackCandle()` when the stock WS store is empty. At the open / on a cold replica both WS and Redis can be empty for a few seconds while Polygon already has a live `I:SPX` snapshot. |
| **Fix** | When `getCurrentSpxCandle().current` is null, SPX now falls through to the shared `getRestFallbackCandle(t)` path (`fetchIndexSnapshot("I:SPX")`). |
| **Status** | FIXED |
