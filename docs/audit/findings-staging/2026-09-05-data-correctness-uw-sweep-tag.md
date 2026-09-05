# data-correctness cron missing runWithBackgroundUwSweep tag

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-2026-09-05-data-correctness-uw-sweep |
| **Priority** | P2 |
| **Status** | FIXED |
| **Area** | `src/app/api/cron/data-correctness/route.ts` |

## Symptom

Full-platform correctness sweeps (`runFullCorrectness`) call `fetchSpxOdteScopedUwLadder` via desk/heatmap verifiers but the route's background `?force=1` dispatch and scheduled sync path were not tagged with `runWithBackgroundUwSweep`, unlike sibling UW-heavy warmers (desk-warm, uw-cache-refresh, vector-universe-snapshot).

## Root cause

The 2026-09-04 audit sweep fixed four background crons but missed `data-correctness`, which fans out to UW oracle reads during SPX desk/GEX cross-checks.

## Fix

Wrap both `runFullCorrectness` call sites (async `?force=1` dispatch and synchronous scheduled sweep) in `runWithBackgroundUwSweep`. Heatmap-only `?surface=heatmap` path unchanged (Polygon-primary).

## Evidence

`src/app/api/cron/data-correctness/route.test.ts` — structural guard on import + wrapper presence.

## Market-open check

During RTH, trigger `GET /api/cron/data-correctness?force=1` once; CloudWatch should show a single `[data-correctness] background done` without concurrent UW rate-limiter starvation spikes on member routes.
