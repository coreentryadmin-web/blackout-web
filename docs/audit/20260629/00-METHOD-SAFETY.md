# CTO Full-Platform Audit — 2026-06-29 · Phase 0 (Method, Safety, Orientation)

> **Type:** AUDIT + VERIFY + DOCUMENT only. No source changes, no prod mutations, no deploys, no
> push to `main`. Branch: `cursor/cto-full-audit-20260629-7635` (cut from `origin/main` @ `d5d67ad`).
> **Author:** acting CTO/Principal/SRE/Security/QA/Data, with live read-only prod access.

## Safety rules in force this pass
- **Postgres:** `SELECT` only, via `DATABASE_PUBLIC_URL` (read path), always `LIMIT`/aggregate. No
  `INSERT/UPDATE/DELETE/DDL`. Verified queries run through `railway run -s blackout-web` (env
  injected; secrets never printed).
- **Redis:** read-only (`GET/SCAN/TTL`) — *not yet reachable from this VM* (internal `.railway.internal`
  URL); Redis state verified indirectly via reader-API `asof` + admin health. Flagged for operator.
- **Cloudflare / Clerk:** read-only.
- **No trades, no money movement, no writes.** Night's Watch / Largo write-or-spend tests are
  **deferred pending explicit approval + a synthetic TEST account** (2 *real* user positions exist in
  `user_positions` — never touched).
- **Secrets/PII redacted** everywhere. Self-probing rate-limited (no aggressive loops).

## Timing caveat
Run started ~02:43 ET (market **closed**; opens 09:30 ET). "Live tick → screen" dynamic-update
checks (Phase 1 freshness, Phase 9 no-refresh) are best verified at **RTH** and are flagged for the
RTH pass. Off-hours we verify: pipeline tracing, DB integrity/reconciliation, cross-tool consistency
of cached values, and freshness *honesty* (does the UI admit staleness?).

## Orientation read (done)
`NORTH_STAR.md`, `ONBOARDING.md`, `.cursor/rules/architecture.mdc`, `api-audit/OPEN-ISSUES.md`
(20:09 ET), `API_INTEGRATION_MAP.md`, `DATA_CORRECTNESS.md`, `HEATMAP_DATA_CONTRACT.md`,
`BLACKOUT_FULL_AUDIT.md`. (`NIGHTHAWK_GROUNDING.md`, `NIGHTS_WATCH.md` read at their Phase-2 tool audits.)

## Findings rules
Every finding cites file:line / endpoint / query. **Adversarially verified** (this repo's tooling
has a false-positive history). Unprovable → labeled `UNVERIFIED HYPOTHESIS`. Severity P0→P3 by blast
radius. Each area gets a **VERIFIED CLEAN** list so coverage is trustable, not just noise.

## Phase progress tracker (updated 2026-06-29 ~17:00 UTC — **PAUSED**, not actively running)
| Phase | Status |
|---|---|
| 0 — Safety/Orientation | ✅ done |
| 1 — Numerical ground truth | 🟡 partial (off-hours DB + SPX/GEX/track-record; **RTH matrix pending**) |
| 2 — Per-tool deep audits | ⬜ pending → see `99-RTH-CONTINUATION-PLAN.md` |
| 3 — Data layer (PG/Redis) | 🟡 partial (PG counts done; Redis pending operator URL) |
| 4 — Realtime/concurrency/idempotency | ⬜ pending |
| 5 — Infra/ops/resilience/scale/cost | ⬜ pending |
| 6 — Auth/billing/compliance | ⬜ pending |
| 7 — External edge (CF/providers/notify) | ⬜ pending |
| 8 — Cross-service wiring | ⬜ pending |
| 9 — Frontend/UX/a11y/mobile/SEO | ⬜ pending (**needs RTH + browser pass**) |
| 10 — Performance | 🟡 partial (P-1 root-caused; PF-1/2/4 noted — **#15–#17 merged since**) |
| 11 — Security | ⬜ pending |
| 12 — Code quality/tests/docs | ⬜ pending |

**Remediation since pause (on `main`, not reflected in Phase 1/10 raw notes):** F-1 → #18, P-1 → #15, PF-1 → #16, PF-2 → #17.

## Approvals I need before proceeding (write/test actions)
1. **Night's Watch (Phase 2):** open a **synthetic position on a TEST account** to verify live
   valuation + per-user isolation. Needs your OK + which test account.
2. **Largo adversarial (Phase 2):** grounding/jailbreak/prompt-injection tests **cost AI spend** and
   hit the live model. Needs your OK (I'll keep it minimal).
All other phases are read-only and proceed without approval.
