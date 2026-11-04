> **kind:** FINDING

## RTH deep audit — SPX oracle prev-close after cash close false P0 — FIXED

| **Status** | FIXED (PR pending) |
| --- | --- |

**Symptom:** `RTH deep audit` on `main@abc4f901` at **Wed 16:02 ET** failed P0: `desk 7683.82 vs Polygon prev-close 7568.92 (Δ 1.518% > 1.5% tol)`.

**Root cause:** `full-site-deep-audit.mjs` keyed live vs prev oracle solely on Polygon `marketstatus/now`. Cash closes **16:00 ET** but `gha-rth-audit` / `inRthOpenWindow()` stay “open” through **16:15** grace. After 16:00, Polygon reports closed while the desk still serves **today’s session** price — comparing to **prior day** `I:SPX/prev` is wrong ground truth (≈1.5% daily move reads as drift).

**Fix:** Use index snapshot when Polygon is open **or** `inRthOpenWindow()` (includes post-close grace); reserve `prev` for true off-window only. Tight 0.3% tolerance only when Polygon market is open.

**Verify:** `npx tsx --test scripts/full-site-deep-audit.test.mjs scripts/audit/lib/spx-oracle-eval.test.mjs`; next **16:00–16:15 ET** RTH deep audit pass.
