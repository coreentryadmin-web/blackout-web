> **kind:** FINDING

## 2026-11-04 — full-site deep audit SPX oracle used prev-close during RTH — FIXED

| **Status** | FIXED (harness) |

**What broke:** RTH deep audit at Wed 16:02 ET failed P0: `desk 7683.82 vs Polygon prev-close 7568.92 (Δ 1.518% > 1.5% tol)` while `gha-rth-audit` logged `RTH: open`.

**Root cause:** Oracle treated Polygon `marketstatus` as authoritative only when `market === "open"`. A missing or `closed` status during the ET cash window forced the off-hours prev-close compare against a live desk on a +1.5% session.

**Fix:** `resolveSpxOracleRth()` — ET `inRthOpenWindow()` fallback when status is absent or conflicts with session time.

**Verify:** `node --import tsx --test scripts/audit/lib/spx-oracle-eval.test.mjs`
