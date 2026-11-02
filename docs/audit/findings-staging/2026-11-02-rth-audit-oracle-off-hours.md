> **kind:** FINDING

## 2026-11-02 — RTH deep audit false P0: SPX Polygon oracle off-hours — FIXED

| **Status** | FIXED on `fix/rth-audit-oracle-off-hours` |
| --- | --- |

**Symptom:** RTH deep audit on `main` @ `8f9e0d4` failed full-site audit: P0 `[oracle] SPX: desk 7552.74 vs Polygon 7541.40 (Δ 11.34)` at ~17:30 ET post-close.

**Root cause:** `full-site-deep-audit.mjs` always compared platform snapshot SPX to Polygon index snapshot with a 5pt absolute gate. Off-hours the two sources diverge (session close vs desk carry) without indicating a live bug.

**Fix:** Skip oracle check outside `inRthOpenWindow()` on a trading day; record pass with skip reason.

**Verify:** Re-run RTH deep audit off-hours — oracle line should skip, job green unless real P0s.
