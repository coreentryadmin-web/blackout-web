> **kind:** FINDING

# Dark-pool ticker roundFloats + nighthawk-edition UW sweep — FIXED

| Field | Value |
|-------|-------|
| **ID** | BO-P2-0106 |
| **Priority** | P1 |
| **Status** | FIXED |
| **Branch** | `fix/dark-pool-ticker-roundfloats-nighthawk-uw-sweep` |

## What was broken

1. **`GET /api/market/dark-pool/ticker`** returned raw `fetchUwDarkPool` payloads without `roundFloats` at the JSON boundary while sibling `GET /api/market/dark-pool` already rounds. Thermal heatmap overlay drilldown could show IEEE float tails on premiums/sizes.

2. **`GET /api/cron/nighthawk-edition`** dispatched `buildEveningEdition` without `runWithBackgroundUwSweep`. The builder fans out ~10+ UW REST calls per ticker via `runUwPooled`, racing live member reads for the same 2-RPS cluster ceiling — the same class zerodte-warm was fixed for in PR #3759.

## Fix

- Wrap dark-pool ticker success response in `roundFloats({ snapshot, symbol })`.
- Wrap `buildEveningEdition(...)` dispatch in `runWithBackgroundUwSweep(() => ...)`.

## Evidence

- Static route tests: `dark-pool/ticker/route.test.ts`, `nighthawk-edition/route.test.ts`
- Pattern scan during hourly wake 2026-09-05

## Blast radius

- Dark-pool overlay drilldown numeric display only (rounding, not logic).
- Nightly edition build UW admission priority only — live dossier reads unchanged.
