# 2026-09-05 — Largo SPX desk brief mislabels GEX king as pin

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P1 (truth contract) |
| **Area** | Largo / BIE SPX desk brief (`composeSpxDeskBrief`) |
| **Status** | FIXED |

## Symptom

When `desk.gex_king` drove the magnet level, the Largo Q&A brief still prose-labeled it `"pin … (price magnet)"` — the same mislabel fixed on the SPX pin panel in #3827's predecessor finding.

## Root cause

`composeSpxDeskBrief` collapsed `desk.gex_king ?? desk.max_pain` into a single `pin` variable and always used pin/max-pain magnet copy.

## Fix

- Split king vs max pain via `briefMagnetLevels()`.
- WHY / LEVELS / NEXT 5M lines use `SPX_PIN_GEX_KING_LABEL_PROSE` or `SPX_PIN_MAX_PAIN_LABEL_PROSE` — never generic "pin" for king.

## Evidence

- `spx-desk-brief.test.ts` — king-wins asserts anchor-node label; max-pain-only asserts no "pin" fabrication.

## RTH validation

- Ask Largo about SPX levels during long-gamma RTH when king clusters near spot.
- Confirm brief reads **GEX king node** / **king (anchor node)**, not "pin (price magnet)".
