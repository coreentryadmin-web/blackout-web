> **kind:** `FINDING`

## RTH deep audit failed off-hours on SPX Polygon oracle Δ — FIXED

| **Status** | FIXED — `fix/rth-audit-spx-oracle-off-hours` |

| Field | Detail |
|---|---|
| **Symptom** | Scheduled `RTH deep audit` on `main` @ `8f9e0d4` failed: P0 `[oracle] SPX: desk 7552.74 vs Polygon 7541.40 (Δ 11.34)` at Mon 17:30 ET (post-close). |
| **Root cause** | `full-site-deep-audit.mjs` always compared desk SPX to Polygon I:SPX with a 5pt hard cap, even off-hours when cross-tool integrity already skips closed-market checks. After close, cached desk spot and Polygon index snapshot fields routinely diverge without a user-visible bug. |
| **Fix** | Gate the oracle block on `inRthOpenWindow()` from `gha-et-window.mjs`; off-hours records an explicit skip pass (same discipline as data-integrity `market closed`). |
| **Evidence** | CI run `41537722853`; drift test in `scripts/full-site-deep-audit.test.mjs`. |
