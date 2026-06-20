# Re-Audit Round 2 — Batch 04: Night Hawk

> **Repo:** `C:\Users\raidu\blackout-web`  
> **Date:** 2026-06-19  
> **Commit:** `d171c68`  
> **Original:** `audits/AUDIT-Night-Hawk.md`

---

## Verification

- `npx tsc --noEmit` — pass
- `npm run build` — pass

---

## Finding status

| ID | Original severity | Status | Evidence |
|----|-------------------|--------|----------|
| **NH-M1** | MEDIUM | ✅ **FIXED** | `hunt-mode.ts:69-96` + `hunt-builder.ts` — per-share `flowEntryPremiumPerShare`, post-Claude `filterPlaybookPlays` on `entry_premium` + `dte_max` |
| **NH-M2** | MEDIUM | ✅ **FIXED** | `hunt-builder.ts:172-173` — gates on `d.scored != null` (matches edition) |
| **NH-LM1** | LOW-MED | ✅ **FIXED** | `day-trade-filters.ts:44-56` — ambiguous direction rejected |
| **NH-L1** | LOW | ⚠️ **PARTIAL** | `embeds/NightHawkRadar.tsx:7-36` — subtitle says "demo visualization"; footer still shows "Scan active" |
| **NH-L2** | LOW | ✅ **FIXED** | `day-trade-filters.ts:83-100` — DTE filter for 0DTE and 1DTE |
| **NH-L3** | LOW | ✅ **FIXED** | `day-trade-filters.ts:90-92` — ET session date for DTE |
| **NH-L4** | LOW | ❌ **OPEN** | `day-trade-agent.ts:14` — phase always `CANDIDATE`; lifecycle never advances |
| **NH-L5** | LOW | ✅ **FIXED** | `AgentPowerModal.tsx:138` — `${play.ticker}-${play.contract ?? idx}` key |
| **NH-S3-EXP** | edge | ✅ **FIXED** | `option-chain-prompt.ts:305` — rejects null expiry |

**Prior fixes confirmed:** chain dedup, Jan rollover, skew double-count, tech-null edition drop, outcome intraday bias, flow limit 450, null premium reject.

---

## NEW findings

| ID | Severity | Status | Evidence |
|----|----------|--------|----------|
| **NH-NEW-01** | HIGH | ✅ **FIXED** | `hunt-builder.ts` — per-share premium estimate + post-Claude cap filter (no block-premium compare) |
| **NH-NEW-02** | MEDIUM | ✅ **FIXED** | `hunt-builder.ts` — `filters.dte_max` → `effectiveMaxDte` + post-Claude DTE filter |

---

## Summary counts

| Status | Count |
|--------|------:|
| ✅ FIXED | 8 |
| ⚠️ PARTIAL | 1 |
| ❌ OPEN | 1 |
| 🆕 NEW | 0 |
