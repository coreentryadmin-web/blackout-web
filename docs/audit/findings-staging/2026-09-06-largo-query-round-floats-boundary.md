# Largo query route missing roundFloats at API boundary

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Priority** | P2 |
| **Area** | Largo / API boundary |
| **PR** | (pending) |

## Symptom

`GET/POST /api/market/largo/query` returned the full Largo turn payload via `NextResponse.json(result)` without `roundFloats`. Sibling `largo/context/route.ts` rounds at the boundary. Members could see IEEE noise in envelope level prices (gamma flip, walls, spot).

## Fix

Wrap the non-streaming JSON response with `roundFloats(result)` before serialization. Regression test mirrors `context/route.test.ts`.

## Verify

- `npx tsx --test src/app/api/market/largo/query/route.test.ts`
- `grep roundFloats src/app/api/market/largo/query/route.ts`
