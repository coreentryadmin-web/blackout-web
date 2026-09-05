> **kind:** FINDING

## SPX desk GEX age clamped future asof → false fresh — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Severity** | P2 |
| **Area** | SPX desk / GEX freshness |
| **Branch** | `fix/spx-desk-gex-age-future-skew` |

### Root cause

`gexDataAgeMs()` and the canonical desk GEX snapshot path computed `Math.max(0, Date.now() - asofMs)` before calling `gexStaleFromAge()`. A clock-skewed future `pos.asof` became `gex_age_ms: 0`, which `gexStaleFromAge(0)` treats as fresh — even though the helper already fail-closes on raw negative age beyond `WS_TIMESTAMP_FUTURE_TOLERANCE_MS`.

### Fix

Remove the `Math.max(0, …)` clamp at both sites so future-skewed stamps reach `gexStaleFromAge` as negative age.

### Evidence

- Source-scan regression: `spx-desk-gex-age-freshness.test.ts`
- Existing unit: `gexStaleFromAge(-60_000) → true` in `spx-desk-rounding-stale.test.ts`

### Blast radius

SPX desk GEX stale pill and `gex_age_ms` on canonical + sticky fallback paths only. Display may show negative age ms during skew (honest); stale pill fires correctly.
