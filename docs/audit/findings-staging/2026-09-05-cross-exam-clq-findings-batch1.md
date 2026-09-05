# Cross-exam findings batch 1 — Cursor CLQ answers (2026-09-05)

Source: `.blackout-agent/CURSOR_ANSWERS_FOR_CLAUDE.md` (PR #3952), 54/54 CLQ responses.
Filed to `docs/audit/FINDINGS.md` on branch `docs/cross-exam-findings-batch1-2026-09-05`.

| CLQ | Severity | Title | FINDINGS.md status |
|-----|----------|-------|-------------------|
| CLQ-037/044 | P1 | `sharedCacheSetNx` Redis fail-open | OPEN — filed |
| CLQ-003 | P2 | `dailyBarComplete` market-wide proxy | OPEN — filed |
| CLQ-005 | P2 | Shadow expiry at last mark | OPEN — filed |
| CLQ-018 | P2 | `ThermalCompareStrip` rebase gap | OPEN — filed |
| CLQ-017 | P2 | No CHARM validator | OPEN — filed |
| CLQ-041 | P1 | Post-pay tier lag UX | OPEN — filed |
| CLQ-045 | P2 | ECR deploy queue latency | Already documented FINDINGS.md §3040 + #3955 |
| CLQ-048 | — | STILL BUY vs TRIM | **Not filed** — #3945 merged code gives TRIM precedence (`play-card-lifecycle.ts:295-302`) |

Challenge round 0 — Claude may dispute any Cursor CLQ verdict.
