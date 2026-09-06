> **kind:** FINDING

## Stale Vector chart technicals still render live-looking spot/EMA/VWAP — FIXED

| Field | Value |
|-------|-------|
| **ID** | BO-P2-largo-chart-technicals-stale |
| **Pri** | P2 |
| **Area** | Ask Largo / Night Hawk Swings |
| **Status** | FIXED (PR pending) |

### Symptom

`chartTechnicalsSection()` prefixed stale Vector reads with "Last snapshot" but still rendered spot, EMA stack, VWAP, RSI, MACD, structure, and desk grade as if live — only the section bias was neutralized.

### Root cause

#4387/#4402 gated bias and added a stale prefix, but did not mirror `vectorDeskSection()`'s early-return pattern that suppresses stale body fields.

### Fix

Early return on stale Vector: show only "Last snapshot" age caveat + optional grade labeled "(from prior snapshot)"; omit all technical fields until refresh.

### Evidence

`npx tsx --test src/lib/swing/play-brief-intel.test.ts` — strengthened regression asserts Spot/EMA/VWAP/RSI absent when stale.
