> **kind:** FINDING

## RTH deep audit false P0 — desk vs Polygon prev-close after the bell on a +1.5% day

| **Status** | FIXED |
| **Area** | `scripts/full-site-deep-audit.mjs`, `scripts/audit/lib/spx-oracle-eval.mjs` |
| **CI** | RTH deep audit on `abc4f901` — `[oracle] SPX: desk 7683.82 vs Polygon prev-close 7568.92 (Δ 1.518% > 1.5% tol)` |

**Root cause:** Off-hours branch compared platform snapshot (today's last print) to Polygon `/prev`
(still the prior session until the daily bar rolls). On a large up day that is correct product
data, not drift.

**Fix:** Always prefer index snapshot (live or session-close) when available; `/prev` only as
fallback. Tolerance: 0.3% for live/session-close, 1.5% for prev-close only.
