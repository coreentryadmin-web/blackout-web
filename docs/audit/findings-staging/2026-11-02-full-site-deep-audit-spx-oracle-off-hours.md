> **kind:** FINDING

## 2026-11-02 — full-site-deep-audit SPX oracle false P0 off-hours — FIXED

| **Status** | FIXED (harness) |
| **Severity** | P0 audit-harness (not prod data) |

**What broke:** Scheduled `RTH deep audit` on `main@8f9e0d4` failed with `[oracle] SPX: desk 7552.74 vs Polygon 7541.40 (Δ 11.34)` at Mon 17:30 ET (market closed).

**Root cause:** `scripts/full-site-deep-audit.mjs` compared desk spot to Polygon index snapshot `value ?? session.close` with a fixed 5pt gate at all times. After RTH the desk intentionally serves **today's settled close** (same convention as `data-validator.mjs` / `spx-desk.ts`), while the snapshot `value` can disagree for hours; comparing to the wrong reference is not a product defect.

**Fix:** Align oracle ground truth with `data-validator.mjs`: `marketstatus/now` → live snapshot during RTH; today's `I:SPX` daily `c` off-hours (fallback `/prev`), percent tolerance 0.3% / 1.5%.

**Verify:** `node --import tsx --test scripts/full-site-deep-audit.test.mjs`; next scheduled `gha-rth-audit` off-hours pass.
