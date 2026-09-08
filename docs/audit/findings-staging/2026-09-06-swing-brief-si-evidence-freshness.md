## 2026-09-06 — [FINDING, Night Hawk Swings / Ask Largo, P2] Short-interest evidence hardcodes freshness "recent" — FIXED

> **kind:** `FINDING`

### Symptom

`GET /api/market/swing/play-brief` short-interest evidence always carried `provenance.freshness: "recent"` even when `fund.as_of` was days old — violating Largo contract C2 (freshness must be measured, not asserted).

### Root cause

`evidenceFromContext()` in `play-brief.ts` correctly stamped `provenance.asOf` from `fund.as_of` (date-only → session-close ET via `etStampFromDateOrIso`) but hardcoded `freshness: "recent"`. Mark and GEX evidence on the same path already derive freshness from observation age via `freshnessFromAgeMs()`.

### Fix

Added `fundamentalsFreshness()` mirroring `gexFreshness()` — parses `fund.as_of` through the C1 ET anchor and measures age against `readMs`. Regression tests cover both a 5-minute-old ISO observation (`recent`) and a date-only August observation (`stale` + correct `16:00 ET` anchor).

### Evidence

- `npx tsx --test src/lib/swing/play-brief.test.ts` — new stale case + updated recent case pass.
- Same pattern as prior HELIX flow freshness fix (`2026-09-06-swing-brief-helix-flow-evidence-freshness.md`).

| **Status** | FIXED — PR opened, merge pending CI/peer-review |
