# Vector volume profile includes extended-hours bars

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Vector / volume profile |
| **Severity** | P2 |

## Symptom

Default-on Vector volume profile overlay could show POC and value-area bands anchored to premarket/after-hours volume on equity tickers, not the current RTH session.

## Root cause

`computeVolumeProfile(minuteBarsRef.current)` in `VectorChart.tsx` and `vector-analytics-core.ts` fed the full multi-session minute buffer with no `lastSessionBars` + `filterRthBarsSec` gate. HOD/LOD, opening range, and VWAP got this gate in the 2026-08-05 audit; volume profile was missed.

## Fix

Add `sessionRthVolumeProfileBars()` and scope both call sites through it. Regression test mirrors the HOD/LOD premarket exclusion fixture.

## RTH validation

On `/vector` with volume profile enabled for an equity (e.g. NVDA) during RTH, confirm POC sits near the RTH price cluster — not at an extended-hours spike level.
