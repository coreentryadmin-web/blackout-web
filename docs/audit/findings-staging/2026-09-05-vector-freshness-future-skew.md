> **kind:** `FINDING`

## 2026-09-05 — [P2, data-correctness] Vector freshness treated future observed_at as live — FIXED

> **kind:** `FINDING` | **Found by:** Cursor autopilot hourly sweep | **Status:** FIXED

| | |
|---|---|
| **Severity** | P2 — Largo Vector tools could label clock-skewed snapshots as `live` |
| **Root cause** | `describeVectorFreshness` clamped negative age to 0 via `Math.max(0, …)`, so writer-ahead `observed_at` beyond tolerance read as age 0 → `freshnessFromAgeMs(0)` → `"live"`. |
| **Fix** | When `observedMs > nowMs + WS_TIMESTAMP_FUTURE_TOLERANCE_MS`, return `freshness: "unknown"` with explicit clock-skew note. Minor skew within 5s still clamps to 0. |
| **Evidence** | Updated `vector-state-freshness.test.ts`; aligns with `isWsUpdatedAtFresh` posture elsewhere. |
