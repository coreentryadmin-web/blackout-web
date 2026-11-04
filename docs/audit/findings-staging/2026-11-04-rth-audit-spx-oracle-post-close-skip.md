> **kind:** FINDING

## RTH deep audit P0 SPX oracle false positive post-close (desk session vs prev-close) — FIXED

| | |
|---|---|
| **Area** | `scripts/full-site-deep-audit.mjs` SPX Polygon oracle block |
| **Status** | FIXED — `scripts/full-site-deep-audit.test.mjs` regression guard updated |
| **Severity** | P0 in CI only (not a member-facing data defect) |

### Root cause

RTH deep audit @ `abc4f901` (Wed ~16:02 ET): Polygon `marketstatus` = closed, but platform snapshot still served **today's session close** (7683.82). The audit's off-hours branch compared that to Polygon `/prev` (7568.92 — prior session close), producing Δ 1.518% > 1.5% tol and a P0 fail.

That is an apples-to-oranges compare after any >1.5% session, not a desk/Polygon drift bug.

### Fix

Run the SPX oracle **only when Polygon reports market open** (live index snapshot + 0.3% tolerance via `spxOracleVerdict(..., true)`). When market is closed, record an explicit skip pass — same discipline as cross-tool integrity's "market closed" skip.

Removed the `/prev` off-hours branch from full-site deep audit (data-validator keeps its own off-hours rules for `/indices`).

### Verification

- `npx tsx --test scripts/full-site-deep-audit.test.mjs scripts/audit/lib/spx-oracle-eval.test.mjs`
- Next `RTH deep audit` run post-close should not P0 on SPX oracle for a normal up day.
