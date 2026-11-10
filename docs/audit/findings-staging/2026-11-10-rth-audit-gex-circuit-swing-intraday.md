## 2026-11-10 — RTH deep audit failed on GEX circuit + swing-discovery intraday — FIXED

> **kind:** `FINDING`

| Field | Detail |
| --- | --- |
| **Symptom** | `gha-rth-audit` on `main` @ `0ba38002` (15:38 ET): P0 GEX cold SPX/SPY, data-integrity discrepancies, cron-watchdog swing-discovery; Polygon log showed circuit open + ON CONFLICT incident upsert noise. |
| **Root cause** | `data-integrity` C6 flagged null matrices during Polygon circuit pauses; swing `AwaitingPhaseSuppress` required POST_CLOSE before suppressing intraday handshake lag between phase ticks. |
| **Fix** | Skip / soften C6 when `isPolygonCircuitOpen()`; intraday suppress when an earlier phase is `done` and the active window has not run yet. |
| **Status** | Fixed. |
