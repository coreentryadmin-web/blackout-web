## 2026-09-04 — [P2, data integrity] `/api/market/quote` returned raw IEEE floats — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Severity** | P2 — member-visible float noise on Thermal header tape (~1.5s poll) |
| **Found by** | Cursor Autopilot hourly bug-pattern scan |
| **Status** | FIXED |

### Root cause

`/api/market/quote` returned raw Polygon/IEEE floats without `roundFloats()`, unlike sibling market routes.

### Fix

Wrap every successful quote JSON payload in `roundFloats()` (2dp default).

### Note

SPX null-change tone was fixed separately on main via `dayChangeTextClass` in `src/lib/api.ts` (#3688 scope narrowed to quote route only).
