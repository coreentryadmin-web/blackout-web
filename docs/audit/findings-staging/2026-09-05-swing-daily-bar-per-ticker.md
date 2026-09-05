> **kind:** `FINDING`

## 2026-09-05 — [P2, data-correctness] Swing `dailyBarComplete` is per-ticker grouped-daily presence — FIXED

| **Status** | FIXED in PR (branch `fix/swing-daily-bar-per-ticker`) |
|---|---|

| | |
|---|---|
| **Severity** | P2 — day-1 IPO / thin names could pass G-S* daily-bar gate when SPY rows exist but ticker has no bar |
| **Root cause** | `src/lib/swing/discovery.ts` set `dailyBarComplete: grouped.length > 0` (market-wide feed posted, not per-ticker). |
| **Fix** | `tickerHasGroupedDailyBar(grouped, ticker)` — true only when grouped-daily carries a row for that symbol. |
| **Test** | `discovery.test.ts` — SPY-only feed → NVDA returns false. |
| **RTH check** | With `SWING_ENGINE_V2_ENFORCE_DAILY_BAR=1`, confirm IPO candidate blocks with `gate:daily_bar_incomplete` when ticker absent from grouped-daily. |
