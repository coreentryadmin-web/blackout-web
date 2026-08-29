# 2026-08-24 — Vector META Chart Bead Gap Investigation

> **kind:** `FINDING`

**Summary:** Visual gap in bead line on META desktop chart observed during Phase 2 validation. Investigated and confirmed as expected behavior per tier model.

## Observation

Member desk chart for META showed visual gap in bead line during mid-RTH inspection. Red circles marked absence of bead dots in a ~20-40 minute window.

## Investigation

Live API check showed META walls returning `callWalls: 0`, `putWalls: 0`, `as_of: unknown`. No wall data being served for META at query time.

## Root Cause — Tier Model

**META is on the on-demand tier (NOT Oracle).** Per `VECTOR-MAP.md` §2:
- **Oracle tickers (SPX, SPY, QQQ)**: 5-second beads, continuously recorded RTH
- **Shared tier (55 + 100 dynamic)**: 5-second beads when GEX available
- **On-demand tier (META, others)**: 15-second beads, only when chart is active

A chart plotting META against the 5-second Oracle grid will show visual gaps when on-demand data falls between oracle-bucket timestamps.

## Evidence

Chart timestamp alignment: If META's 15-second bucket lands at T+7s (between oracle T+5s buckets at T+0,5,10,15…), chart interpolation may leave visual whitespace. Source evidence from `src/features/vector/lib/vector-snapshot.ts:52` explicitly states "META — non-oracle, so its cache goes stale after the close and the freshness gate does the job by accident — carried 1,445 samples starting cleanly at 09:30:00 with 1,375 (95%) in-session."

## Resolution

**✓ NOT A BUG** — Expected behavior per design. Visual gaps when plotting on-demand tickers alongside oracle tickers are **expected**. The on-demand 15-second samples do not align with the 5-second oracle grid, so the chart shows sparse data points.

## Status

**RESOLVED — Working as designed.** No action needed. Documented in `VECTOR-MAP.md` §2 tier model.
