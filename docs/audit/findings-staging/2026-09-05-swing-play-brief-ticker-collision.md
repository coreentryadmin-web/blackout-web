# Swing Ask Largo brief — OPEN tab resolves WATCH lane row on ticker collision

> **kind:** FINDING

| **Status** | FIXED (PR pending) |
|------------|-------------------|

## Symptom

On `/nighthawk?view=swings`, selecting an **OPEN** row (e.g. NRG 110C HOLD +98%) rendered Ask Largo sections for a **WATCH** play (NRG 115C) — `Entry` instead of `Management`, headline contract mismatch.

`scripts/audit/ask-largo-swing-brief-validate.mjs` failed OPEN tab: missing `Management` section (2026-09-05 post-#4056 deploy).

## Root cause

1. Deck play ids are `SWING:{TICKER}` without ledger `positionId` for live rows.
2. `pickLanePlayForBrief` with no status hint returned the highest-score WATCH lane row when a same-ticker live row also existed.
3. `loadOpenTerminalPlay` picked `matches[0]` arbitrarily when multiple open rows shared a ticker.

## Fix

- Stamp `positionId` on live `HorizonPlay` rows; propagate to `TerminalPlay.id` (`SWING:NRG:{id}`).
- Pass `positionId` query param from `useSwingPlayBrief`.
- Prefer single live row in `pickLanePlayForBrief` when status hint absent.
- Disambiguate multi-row open ledger by status + contract hints.

## Evidence

- Prod validation report: `/opt/cursor/artifacts/ask-largo-validate-20260905/validation-report.json` (OPEN fail before fix).
- Regression: `src/lib/swing/play-brief-resolve.test.ts` — live-over-WATCH without status hint.
