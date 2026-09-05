# 2026-09-05 — Thermal triple-desk header paired live spot with stale matrix change_pct — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **Priority** | P2 data correctness |
| **Found by** | Cursor hourly pattern scan |
| **Status** | FIXED — `rebaseChangePct(pushSpot, { price: matrixSpot, change_pct: matrixChangePct })` when push quote is live |

## Root cause

`ThermalTripleDesk` column header used `headerChangePct = pushChangePct ?? matrixChangePct` while `headerSpot` preferred live push price. When the SSE quote had price but `changePct` was still null (pre-REST anchor), the header showed matrix-anchored day-change % against a fresher spot — wrong sign/magnitude.

## Fix

Mirror `GexHeatmap.tsx` header chain: rebase matrix snapshot when `pushSpot` is live; fall back to push/matrix pct only when rebase is impossible.

## Test

`src/features/thermal/components/ThermalTripleDesk-header-change-pct.test.ts`
