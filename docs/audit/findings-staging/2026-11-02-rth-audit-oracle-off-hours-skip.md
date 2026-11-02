> **kind:** FINDING

## RTH deep audit P0 oracle false-positive off-hours — FIXED

| **Status** | FIXED |
|------------|-------|

**Symptom:** `RTH deep audit` failed at Mon 17:30 ET with P0 `[oracle] SPX: desk 7552.74 vs Polygon 7541.40 (Δ 11.34)`.

**Root cause:** `full-site-deep-audit.mjs` always compared platform snapshot SPX to Polygon index snapshot with a 5pt absolute gate. After the cash session, desk and Polygon often reference different update clocks (last live tick vs snapshot value/close), so the check is not a correctness signal.

**Fix:** Run the Polygon SPX oracle only on trading days during `inRthOpenWindow()`; off-hours record an explicit skip pass (same discipline as cross-tool integrity when `market_open` is false).

**Validate:** Re-run `node scripts/gha-rth-audit.mjs` off-hours — full-site section should show oracle skip, not P0.
