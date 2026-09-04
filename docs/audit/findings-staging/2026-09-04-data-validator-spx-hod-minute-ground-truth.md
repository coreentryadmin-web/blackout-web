# 2026-09-04 — data-validator SPX HOD false FAIL during RTH

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **What prompted this** | `data-validator.mjs` reported `spx-desk: hod vs Polygon day high` FAIL during live RTH (desk=7750.19, polygon daily h=7742.22). |
| **Root cause** | Validator compared desk HOD to Polygon's **daily** aggregate bar, which lags intraday minute prints during an open session. Desk HOD matched Polygon **minute** max exactly (7750.19). |
| **Fix** | `sessionExtremesFromMinuteBars()` derives ground-truth HOD/LOD from today's minute aggregates; daily bar is fallback only when minutes are empty. |
| **Status** | FIXED |
