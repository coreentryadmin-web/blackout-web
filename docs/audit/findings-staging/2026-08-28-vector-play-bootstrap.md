# Vector play engine blank on most tickers — FIXED

> **kind:** FINDING

## Symptom

Members reported the Vector Suggested Play + PLYS rail missing on most names (SPX, TSLA, etc.) — only a few showed it.

## Root cause

Two separate issues:

1. **Cold-load gap (primary):** `playEmit` was only set when `VectorChart` called `emitPlay()` after lightweight-charts mounted + often after the first SSE tick. On-demand tickers this left the play rail empty for **5–15s** even though bootstrap bars/walls/flip were already loaded.
2. **Pivot neutral (shipped #3054):** PLYS panel hid on pivot plays at the gamma flip — separate fix.

SPX Slayer embed (`embed="chart-only"`) intentionally has **no play rail** — full play engine lives on `/vector` only.

| **Status** | FIXED — bootstrap play from seed + early emitPlay on chart props |
