# SPX pulse route served unrounded floats — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Severity** | P2 |
| **Area** | SPX Slayer `/api/market/spx/pulse` |
| **Branch** | `fix/spx-pulse-round-floats` |

## Symptom

`/api/market/spx/pulse` returned `loadSpxDeskPulse()` raw JSON while every sibling SPX desk route (`/spx/desk`, `/spx/bootstrap`, `/spx/pin`, `/spx/flow`, `/spx/merged`) already called `roundFloats()` at the API boundary. Members polling the pulse lane could see IEEE float tails on spot, `change_pct`, and VWAP fields.

## Root cause

Omission when pulse was split into its own poll lane — the loader was shared but the route never got the same boundary guard added to the other SPX routes in the Aug 2026 float-hygiene sweep.

## Fix

Import `roundFloats` and wrap the pulse payload: `NextResponse.json(roundFloats(pulse), ...)`.

## Evidence

- Source scan: only `/spx/pulse` among SPX desk-loader routes lacked `roundFloats`.
- Regression: `src/app/api/market/spx/pulse/route.test.ts` (pattern matches `/spx/flow` test).

## Market-open validation

On `/terminal` (SPX Slayer) during RTH, confirm pulse rail spot/change% match `/spx/bootstrap` within rounding — no long decimal tails in network tab on `/api/market/spx/pulse`.
