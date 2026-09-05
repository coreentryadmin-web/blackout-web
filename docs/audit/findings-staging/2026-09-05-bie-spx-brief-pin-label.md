# BIE SPX desk brief mislabels GEX king as generic "pin"

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-0106 |
| **Priority** | P2 |
| **Status** | FIXED |
| **PR** | (this PR) |

## Symptom

`composeSpxDeskBrief` collapsed `desk.gex_king ?? desk.max_pain` into generic prose:
"pullbacks bought back toward **pin** 5900" and `LEVELS … pin 5900 (price magnet)` even when the
level was the **GEX king node** — the same pin-vs-king confusion the SPX pin panel fixed in
`spx-metric-labels.ts` / `SpxPinForecast.tsx`.

## Root cause

`buildWhy` and LEVELS builder used hardcoded `"pin"` without tracking magnet source.

## Fix

`resolveDeskMagnet()` + `deskMagnetProse()` — GEX king uses `SPX_PIN_GEX_KING_LABEL_PROSE`, max pain
uses lower-case `SPX_DESK_MAX_PAIN_LABEL`. Regression tests in `spx-desk-brief.test.ts`.

## RTH validation

Open SPX Slayer live commentary / Largo SPX brief during RTH — WHY and LEVELS lines should say
"GEX king node" when king is the magnet, never bare "pin".
