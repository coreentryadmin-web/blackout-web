# SPX playbook breakout HOD/LOD used extended-hours bars — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-spx-playbook-breakout-rth |
| **Status** | FIXED |
| **Area** | SPX Slayer playbook / `spx-play-technicals.ts` |
| **PR** | (pending) |

## Symptom

`sessionBreakoutExtremesFromBars` computed session HOD/LOD from **all** minute bars returned by Polygon, including premarket/after-hours prints. Desk session stats already gate on RTH via `filterRthBars` in `spx-session.ts`; playbook breakout flags did not.

Premarket spikes could inflate session HOD and suppress `hod_break`, or depress LOD and suppress `lod_break` — wrong playbook gate inputs during RTH.

## Root cause

`sessionBreakoutExtremesFromBars` iterated raw `bars` without the cash-session filter used elsewhere (`filterRthBars`, 09:30–16:00 ET).

## Fix

- Export `filterRthBars` from `src/lib/providers/spx-session.ts`
- Apply RTH filter inside `sessionBreakoutExtremesFromBars` before excluding the forming last bar
- Regression test: premarket 7500 HOD spike ignored; RTH HOD stays 7410

## RTH validation

On next market open: confirm SPX playbook `hod_break`/`lod_break` flags only react to cash-session extremes (compare against desk HOD/LOD ladder, not premarket wicks).
