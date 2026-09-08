# Largo MTF VWAP mislabeled as session VWAP — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Severity** | P2 |
| **Area** | Largo / Night Hawk technicals |
| **PR** | fix/largo-mtf-vwap-session-scope |

## What was broken

`computeLevelsFromBars()` accumulated typical-price × volume across the entire bar window with no session reset. For daily MTF (120 sessions) and hourly MTF (30 days), the result was a multi-day cumulative average mislabeled as `vwap`. Night Hawk `technicals.ts` surfaced `mtf.timeframes.daily.vwap` on the card, so Ask Largo could cite a 120-day number when asked about session VWAP.

## Fix

- `includeVwap: false` for daily/hourly `computeLevelsFromBars` calls in `fetchPolygonMtfTechnicals`
- Intraday m15 bars (today only) still compute session VWAP
- Night Hawk card reads `m15.vwap` instead of `daily.vwap`

## RTH validation

On market open, compare Night Hawk swing technicals VWAP vs Vector chart session VWAP for the same ticker — they should be in the same ballpark, not orders of magnitude apart.
