## 2026-08-28 — [FINDING, P2 providers] UW stock-state index guard over-blocked I:SPY ETF fallback — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Symptom** | PR #3017 blocked all `I:` roots; `seedPulseSnapshotFromUwPrices` uses `I:SPY`, which maps to UW ticker `SPY` (ETF, HTTP 200) — would be silently skipped after merge. |
| **Fix** | Replace prefix guard with explicit unsupported ticker set `{SPX,VIX,NDX,RUT}`. |
| **Status** | FIXED — `spot-fallback.ts`, `spot-fallback.test.ts` (+`I:SPY` case). Stacks on #3017. |
