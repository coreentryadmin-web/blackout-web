# 2026-09-05 — Thermal triple-desk header change_pct rebase

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Area** | `ThermalTripleDesk.tsx` column headers |
| **Status** | FIXED |

## Symptom

When a live push quote arrives with a fresher spot than the matrix snapshot, column headers used `pushChangePct ?? matrixChangePct` without `rebaseChangePct`. If push spot moved but change% was still anchored to the matrix snapshot, the header showed session-open drift instead of prior-close %.

## Root cause

`GexHeatmap.tsx` was fixed to rebase on push spot divergence; `ThermalTripleDesk.tsx` triple-column headers were missed.

## Fix

When both `pushSpot` and `matrixSpot` are available, rebase via `rebaseChangePct(pushSpot, { price: matrixSpot, change_pct: matrixChangePct })` before falling back to push/matrix change.

## Evidence

- `ThermalTripleDesk-header-change-pct.test.ts` — source-scan assertions.

## RTH validation

- `/heatmap` triple-desk view: SPY/QQQ/SPX column headers show consistent prior-close % when live push spot ticks ahead of matrix poll.
