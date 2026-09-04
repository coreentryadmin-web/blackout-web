## 2026-09-04 — [FINDING, P1 data-correctness] `/api/market/indices` VIX change_pct sign disagreed with Polygon — FIXED

> **kind:** FINDING

| Field | Detail |
|---|---|
| **What prompted this** | Autopilot `data-validator.mjs` live run during RTH: `VIX change_pct sign matches Polygon` FAIL — app `+0.07%` vs Polygon `-0.349%` while VIX price agreed within tolerance. |
| **Root cause** | `src/app/api/market/indices/route.ts` overlaid REST index snapshots with `getStockLiveCandle("SPX"|"VIX")` + `withFreshPrice`. Stock-candle-store ticks (A.*) anchor day-change to session open; indices (`I:SPX`/`I:VIX`) ground on prior close via `/v3/snapshot/indices.session.change_percent`. Rebasing a WS price from the wrong anchor flipped VIX from negative to positive. |
| **Fix** | New `src/lib/providers/index-snapshot-overlay.ts` mirrors spx-desk `mergeWsIndexSnapshots`: read indices WS from `indexStore` or Redis `spx:pulse:snapshot`, trust WS `change_pct` only when `open_source === "rest"`, else `rebaseChangePct` against REST `prev_close`. |
| **Regression guard** | `src/lib/providers/index-snapshot-overlay.test.ts` — ws-bar anchor must rebase negative when REST prior close says down day. |
| **Status** | FIXED |
