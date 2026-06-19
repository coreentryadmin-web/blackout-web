# Re-Audit — Batch 02: Market Data Providers

> **Repo:** `C:\Users\raidu\blackout-web`  
> **Phase:** 3 · **Date:** 2026-06-19  
> **Original:** `audits/AUDIT-Market-Data-Providers.md`

---

## Finding status

| ID | Status | Evidence |
|----|--------|----------|
| **P1** | ✅ **FIXED** | `flow-ingest.ts` — `created_at` cursor |
| **P2** | ✅ **FIXED** | `isUwChannelFresh("flow_alerts")` |
| **P6/P7** | ✅ **FIXED** | Prior-close breadth + near high/low labels |
| **B2-01** | ✅ **FIXED** | `spx-desk.ts:929-941` |
| **B2-02** | ✅ **FIXED** | `shouldBlockForTradingHalt` + `isTradingHaltChannelStale` in `uw-socket.ts`; consumed in `spx-play-gates.ts` |
| **B2-03** | ✅ **FIXED** | `buildSpxDesk` — `ensureDataSockets()` + `mergeWsIndexSnapshots(snapsRaw)` |
| **S3-01** | ✅ **FIXED** | `spx-session.ts:83` — RTH uses `< 16*60` |
| **S3-02** | ✅ **FIXED** | `unusual-whales.ts` — 30m max stale cache on error path |
| **S3-03** | ✅ **FIXED** | `macro-events.ts` — `ALL_MACRO_SCHEDULE` includes 2027+ |
| **S3-04** | ✅ **FIXED** | `greek-exposure-summary.ts` — ET default date |
| **S3-05** | ✅ **FIXED** | `flow-ingest.ts:71-74` — documented `created_at`-only cursor |

---

## Summary counts

| Status | Count |
|--------|------:|
| ✅ FIXED | 13 |
| ⚠️ PARTIAL | 0 |
| ❌ OPEN | 0 |
| 🆕 NEW | 0 |
