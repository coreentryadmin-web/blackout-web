## 2026-09-04 — [CORRECTNESS/PERF, P2 platform-wide] Autonomous bug sweep batch 2 — desk-warm UW reservation, stale-age clamps, change_pct fabrication

| Field | Value |
|-------|-------|
| **Severity** | P2 (mix of perf + member-visible correctness) |
| **Status** | FIXED on `cursor/platform-bug-sweep` |
| **PR** | (pending) |

### Findings fixed

1. **`desk-warm` cron missing `runWithBackgroundUwSweep`** — same UW-concurrency starvation shape as #3479; `loadMergedSpxDesk` + flows warm ran bare against the 2-RPS ceiling.
2. **VectorChart `dataAgeMs` unclamped** — future `dataReceivedAtMsRef` made play conviction read as fresh under clock skew.
3. **`/api/market/quote` WS index age unclamped** — negative age passed stale gate; future timestamps served as live.
4. **`/api/market/quote` stock WS `change_pct`** — session-open anchor before REST seed; now rebases off cached REST via `withFreshPrice` when available.
5. **`toolQuote` WS path** — returned `change_pct: 0` (fabricated flat day); now uses `getStockLiveCandle().changePct` for equities.
6. **`spx-desk` last-resort pulse fallback** — served `prev_close: null` with non-null `change_pct`, inviting inversion.
7. **`SpxPulseRail` stale chip** — future `polled_at` never went stale; now uses `ZERODTE_MARK_FUTURE_TOLERANCE_MS`.
8. **`/api/market/heatmap`** — sectors/movers served unrounded at API boundary.

### Regression guards

- `desk-warm/route.test.ts` — background sweep tag
- `quote/route.test.ts` — WS age + withFreshPrice
- `vector-chart-viewport.test.ts` — clamped dataAgeMs
- `spx-pulse-change-basis.test.ts` — prior_close on fallback
- `heatmap/route.test.ts` — roundFloats
