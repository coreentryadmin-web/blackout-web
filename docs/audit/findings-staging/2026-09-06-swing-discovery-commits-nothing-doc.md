## 2026-09-06 — [FINDING, swing-discovery] Operator docs falsely claimed "commits nothing" — FIXED

> **kind:** `FINDING`

| Field | Detail |
| --- | --- |
| **Source** | `docs/audit/SWING-SYSTEM-CTO-AUDIT-2026-09-06.md` findings #4, #18 |
| **Severity** | High |
| **Status** | FIXED in `fix/swing-discovery-doc-accuracy-0ef2` |
| **What was broken** | `src/app/api/cron/swing-discovery/route.ts` header and `src/lib/cron-registry.ts` `swing-discovery` description both said "WATCH-only, commits nothing" while `buildDiscoveryDeps()` has wired `insertPosition`, `promoteCommit`, `insertShadowPosition`, and `resolveProductionPortfolioBudget()` since 2026-07-24. Admin cron-health echoes the registry string. |
| **What changed** | Updated route header, cron-registry description, and `discovery.ts` file-header note to state that the authorized cron performs budget/caps/idempotency-gated live commits. Added `swing-discovery-doc-accuracy.test.ts` ratchet. |
| **Market-open check** | Admin → Operations → Cron health: `swing-discovery` description should mention live commits. No runtime behavior change. |
