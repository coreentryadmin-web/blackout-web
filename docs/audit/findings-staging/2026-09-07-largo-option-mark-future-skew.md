## 2026-09-07 — [FINDING, Largo C2] Option mark provenance freshness misread future-skewed timestamps as unknown — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Area** | Night Hawk Swings / Ask Largo (`play-brief.ts`) |
| **Status** | FIXED in `fix/largo-option-mark-future-skew` |

**Symptom:** `evidenceFromContext` stamped option-mark provenance via `freshnessFromAgeMs(readMs - markMs)`. Negative age (clock-skewed future `markAsOf`) returned `"unknown"` instead of fail-closed `"stale"` — same class of defect closed for GEX matrix (#4452) and fundamentals (#4454).

**Fix:** `optionMarkFreshness()` applies `WS_TIMESTAMP_FUTURE_TOLERANCE_MS` guard before delegating to `freshnessFromAgeMs`. Regression test in `play-brief.test.ts`.

**RTH check:** Open a live OPEN swing row on Night Hawk Swings → Ask Largo brief → confirm option-mark evidence freshness chip reads stale (not unknown) if mark timestamp is skewed.
