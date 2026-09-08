# 2026-09-05 — roundFloats at platform intel / coaching / brief API boundaries

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Priority** | P2 |
| **Area** | API response shaping |

## Symptom

`/api/platform/intel`, `/api/coaching/alerts`, `/api/brief/premarket`, and the internal `platform-intel-snapshot.ts` helper returned raw Postgres/IEEE floats (e.g. `7499.360000000001`) without `roundFloats`, unlike sibling market routes.

## Fix

Wrap JSON responses with `roundFloats()` at the API boundary; mirror in `platform-intel-snapshot.ts` for Largo/Night Hawk prompt context. Source-scan regression test: `src/app/api/platform/platform-roundfloats-routes.test.ts`.

## Verify

- `npx tsx --test src/app/api/platform/platform-roundfloats-routes.test.ts`
- `npx tsx --test src/lib/round-floats.test.ts`
