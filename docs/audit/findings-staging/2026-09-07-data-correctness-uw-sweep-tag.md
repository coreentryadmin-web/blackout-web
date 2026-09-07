# Data-correctness cron missing UW background-sweep tag — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-0101 |
| **Severity** | P2 |
| **Area** | cron / UW rate limiter |
| **Status** | FIXED in PR (fix/data-correctness-uw-sweep-tag) |

## Symptom

The `data-correctness` cron runs full-platform and heatmap verifiers that call UW-backed ladder reads (`fetchSpxOdteScopedUwLadder` via heatmap/desk verifiers) without the shared `runWithBackgroundUwSweep` tag used by peer UW-heavy crons (`uw-cache-refresh`, `desk-warm`, `flow-ingest`, etc.). During RTH that can consume a UW concurrency slot without leaving headroom for live member traffic.

## Root cause

Both the synchronous sweep path and the `?force=1` background dispatch called `runFullCorrectness` / `runHeatmapCorrectness` bare.

## Fix

Wrap both call sites in `runWithBackgroundUwSweep(() => …)` and add source-scan regression tests mirroring `flow-ingest/route.test.ts`.

## Verify

- `npx tsx --test src/app/api/cron/data-correctness/route.test.ts`
- RTH: confirm data-correctness sweep still posts scorecard; no duplicate Discord alerts (existing debounce tests unchanged).
