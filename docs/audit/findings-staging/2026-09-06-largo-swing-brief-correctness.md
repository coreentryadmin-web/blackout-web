# Largo swing play-brief — three correctness fixes

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P1-largo-brief-2026-09-06 |
| **Status** | FIXED |
| **Area** | Night Hawk Swings / Ask Largo |
| **PR** | fix/largo-swing-brief-correctness |

## Symptoms

1. `GET /api/market/swing/play-brief?playId=SWING:NRG` (no `ticker`) returned 404 even when playId was valid — empty string blocked playId fallback in `resolveSwingPlayForBrief`.
2. SPY/QQQ index swings could narrate peer earnings beat-rates for a random upcoming print from the market-wide Meridian slice.
3. Default thesis-health persistence pillar falsely classified as **faded** due to IEEE float (`0.35 >= 0.4-0.05` → false), producing fabricated "Pillar fade" coaching.

## Fix

- `play-brief-resolve.ts`: treat blank `ticker` as absent before uppercasing.
- `play-brief-meridian-peer.ts` + narrative coaching: skip peer cohort for index tickers; require `earnings.ticker === swing ticker`.
- `thesis-health.ts`: compare pillar scores in centi-points to avoid float boundary false fades.

## Evidence

- `npx tsx --test` on `play-brief-resolve.test.ts`, `thesis-health.test.ts`, `play-brief-meridian-peer.test.ts` — all pass.
