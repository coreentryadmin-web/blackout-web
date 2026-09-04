## 2026-09-04 — [FINDING, P2] platform-integrity false WARN on tier-gated endpoints — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **Area** | Ops / validation |
| **Status** | FIXED |
| **PR** | (this branch) |

`npm run validate:platform-integrity` treated HTTP 401 on `/api/market/gex-positioning`,
`/api/market/gex-heatmap` (SPY/QQQ), and `/api/market/vector/walls` as **WARN** (empty strikes /
missing spot) even though the probe is intentionally unauthenticated. During RTH lifecycle this
produced 4 spurious warnings on every sweep.

**Fix:** classify 401 as `SKIP` with `tier-gated` detail — same pattern already used for desk,
flows, nighthawk, and zerodte checks.
