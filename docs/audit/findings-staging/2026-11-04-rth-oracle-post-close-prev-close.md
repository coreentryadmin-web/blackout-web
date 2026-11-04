> **kind:** `FINDING`

## 2026-11-04 — RTH deep audit P0 SPX oracle post-close prev-close false fail — FIXED

| **Status** | Fixed (PR pending) |
|------------|-------------------|
| **Symptom** | `RTH deep audit` job `audit` failed on `main` (run 41912133395): `[oracle] SPX: desk 7683.82 vs Polygon prev-close 7568.92 (Δ 1.518% > 1.5% tol)` at Wed 16:02 ET. |
| **Root cause** | `full-site-deep-audit.mjs` used Polygon `marketstatus` closed → `/prev` prior-day close vs platform snapshot still showing **today's session spot** after the 16:00 cash close. Any |day| move > 1.5% false-fails — not a desk bug. |
| **Fix** | Run SPX oracle only when Polygon reports `market === open` (live index snapshot + 0.3% tol). When closed, record pass skip line — no prev-close compare in this harness. |
| **Verify** | `node --test scripts/full-site-deep-audit.test.mjs scripts/audit/lib/spx-oracle-eval.test.mjs`; next weekday RTH deep audit after 16:00 ET should not P0 on oracle. |
