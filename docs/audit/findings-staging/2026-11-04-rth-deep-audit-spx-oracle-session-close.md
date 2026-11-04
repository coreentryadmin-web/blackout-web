> **kind:** FINDING

## RTH deep audit SPX oracle false P0 post-close — FIXED

| **Status** | FIXED (PR branch) |
| --- | --- |

**Symptom.** Full-site deep audit (workflow run 41912133395 @ `abc4f901`, ~16:02 ET 2026-11-04): P0 `[oracle] SPX: desk 7683.82 vs Polygon prev-close 7568.92 (Δ 1.518% > 1.5% tol)`.

**Root cause.** Off-hours branch compared desk `platform/snapshot` SPX price to Polygon `/prev` (prior **session** close). After a +1.5% up day, desk reflects **today's** level while `/prev` is **yesterday's** settle — the check measured daily return, not cross-source agreement.

**Fix.** Off-hours oracle prefers `I:SPX` index snapshot `session.close` (fallback `value`, then `/prev` only when snapshot unavailable). `spxOracleVerdict` tolerance unchanged (0.3% RTH / 1.5% off-hours).

**Verify.** `node --test --import tsx scripts/audit/lib/spx-oracle-eval.test.mjs`; post-merge RTH deep audit green on a post-close weekday with a non-flat SPX session.
