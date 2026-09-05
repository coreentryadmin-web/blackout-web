# 2026-09-05 — SPX desk brief mislabels GEX king as pin

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Area** | SPX desk BIE brief (`composeSpxDeskBrief`) |
| **Status** | FIXED |

## Symptom

When `desk.gex_king` was present, the Live Desk AI brief (`/api/market/spx/commentary`, Largo Q&A) labeled the strike as `pin … (price magnet)` and used pin pullback prose — even though the pin forecast panel and metric labels already distinguish **GEX king node** from **effective max pain** (#3816 / `spx-metric-labels.ts`).

## Root cause

`composeSpxDeskBrief` collapsed `desk.gex_king ?? desk.max_pain` into a single `pin` number without tracking which metric won, then reused generic pin copy in LEVELS, WHY, and NEXT 5M.

## Fix

- `resolveDeskMagnet()` tracks `gex_king` vs `max_pain` kind.
- LEVELS / WHY / NEXT 5M use `SPX_PIN_GEX_KING_LABEL_PROSE` or pin/max-pain prose via shared helpers.

## Evidence

- `spx-desk-brief.test.ts` — king-only desk never emits `pin … (price magnet)`; max-pain-only desk keeps effective-max-pain label.

## RTH validation

- Open SPX Slayer during long-gamma RTH when GEX king is near spot — commentary rail LEVELS line should read `GEX king node <strike>`, not `pin (price magnet)`.
