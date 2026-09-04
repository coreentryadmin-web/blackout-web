# 2026-09-04 — zerodte board sim path missing roundFloats at API boundary

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Priority** | P2 |
| **Area** | 0DTE / Night Hawk admin sim |
| **PR** | (this branch) |

## Symptom

`GET /api/market/zerodte/board?sim=1` (admin-only) served sim frames straight from Redis via `getSimBoardPayload()` with no `roundFloats` at the route boundary. Member path already rounds inside `buildZeroDteBoardPayload()` in `zerodte-service.ts`, but sim frames are written by the admin ingest path and bypass that pipeline — synthetic/replay frames could expose IEEE noise (e.g. `7499.360000000001`) on the admin sim desk.

## Root cause

Isolation design (`zerodte-sim-board.ts`) deliberately avoids importing member write/read helpers; rounding was only applied on the member derivation path, not on sim reads.

## Fix

Wrap both board route success paths in `roundFloats()` at `src/app/api/market/zerodte/board/route.ts`. Regression test in `zerodte-sim-board.test.ts` asserts the route imports and applies rounding on sim + member branches.

## Validation

- `npx tsx --test src/lib/platform/zerodte-sim-board.test.ts`
- RTH: open `/nighthawk?sim=1` as admin after seeding a sim frame; confirm premiums/PnL% show 2dp without long float tails.
