> **kind:** FINDING

## RTH deep audit failed post-close Polygon oracle (2026-11-02)

| **Status** | FIXED |

**Symptom:** `RTH deep audit` / `audit` on `main` @ `8f9e0d4` (run 41537722853) P0: `[oracle] SPX: desk 7552.74 vs Polygon 7541.40 (Δ 11.34)`.

**Cause:** `full-site-deep-audit.mjs` compared desk snapshot to Polygon I:SPX with a flat **$5** threshold **after RTH** (22:31 UTC / 17:31 ET). Off-hours index `value` vs cached desk lane can diverge without a product bug — same reason `data-integrity` skips cross-tool checks when `market_open` is false.

**Fix:** Skip Polygon SPX oracle when `!inRthOpenWindow()`; in RTH use `fracDiff` **0.005** (matches `desk-verifier.ts`).

**Check:** `node --test scripts/full-site-deep-audit.test.mjs`; next scheduled RTH deep audit green.
