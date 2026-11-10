## 2026-11-10 — Cron query failed on swing-discovery handshake false stale — FIXED

> **kind:** `FINDING`

| Field | Detail |
| --- | --- |
| **Symptom** | Scheduled `Cron audit query` on `main` @ `1f445e92` failed: `problems: swing-discovery` only (watchdog HTTP fallback). |
| **Root cause** | `evaluateJob` used the 36h `stale_after_min` registry default for phase-anchored swing-discovery; the unit test already required `swingDiscoveryHandshakeStaleMin()` (~60h) but production code never wired it. Writer-target override only ran for failed/stale, not `warning`. |
| **Fix** | Wire `swingDiscoveryHandshakeStaleMin()` in `effectiveStaleMinutes`; always probe serving snapshot when swing-discovery status ≠ healthy. |
| **Status** | Fixed. |
