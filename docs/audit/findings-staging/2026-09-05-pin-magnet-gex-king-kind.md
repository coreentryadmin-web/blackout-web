# 2026-09-05 — Pin forecast mislabels GEX king magnet as max pain

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P1 (truth contract) |
| **Area** | SPX pin forecast (`pickLongGammaMagnet`, `/api/market/spx/pin`) |
| **Status** | FIXED |

## Symptom

In long-gamma regime, when the heaviest |GEX| strike (king node) wins over distant effective max pain, `magnet.kind` was served as `"max_pain"` even though the strike is the king anchor — members saw two different prices both labelled max pain.

## Root cause

`pickLongGammaMagnet()` returned `magnetKind: "max_pain"` for all king-driven outcomes. `PinMagnetKind` had no `"gex_king"` variant.

## Fix

- Added `"gex_king"` to `PinMagnetKind`.
- King-driven magnets now return `magnetKind: "gex_king"`.
- Pin panel labels/drivers/chart use `SPX_PIN_GEX_KING_LABEL` ("GEX KING") distinct from effective max pain.

## Evidence

- `spx-pin-long-gamma.test.ts` — king-wins cases assert `gex_king`.
- `spx-metric-labels.test.ts` — GEX king label distinct from effective max pain.

## RTH validation

- Open SPX desk pin panel during RTH long-gamma session when king clusters near/above spot.
- Confirm magnet row reads **GEX king node** (not effective max pain) when king strike wins.
- Secondary effective max pain driver should still appear when king is primary magnet.
