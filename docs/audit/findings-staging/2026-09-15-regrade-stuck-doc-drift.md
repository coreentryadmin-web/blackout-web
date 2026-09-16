## 2026-09-15 — [FINDING, P4 Night Hawk Legacy, doc-only — FIXED] `regrade-stuck.ts`'s header comment contradicted its own actual wiring

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED — comment corrected to state both invocation paths (admin route AND the nightly cron). No behavior change. |
| **Severity** | P4 — doc-only, no functional impact, but a real stale-doc trap for the next reader deciding whether stuck-outcome repair needs an explicit trigger. |

### What was broken

`src/features/nighthawk/lib/regrade-stuck.ts`'s module header comment stated the repair is
"admin-invoked, so historical fixes stay an explicit, audited action instead of a silent
every-boot sweep." That was true of the original design, but a later "PR-N1 follow-up" wired
`regradeStuckNighthawkOutcomes({ limit: 50 })` directly into
`src/app/api/cron/nighthawk-outcomes/route.ts` (line ~109), where it now runs automatically every
night as part of the routine grading cron (fail-soft — a `.catch` so it can never fail the
grading run), in addition to the pre-existing admin route
(`src/app/api/admin/nighthawk/regrade-stuck-outcomes/route.ts`). The header comment was never
updated to reflect the cron wiring, so it asserted the opposite of what the code two files over
actually does.

### Evidence

- `grep -n "regradeStuckNighthawkOutcomes" src/app/api/cron/nighthawk-outcomes/route.ts src/features/nighthawk/lib/regrade-stuck.ts` shows the cron route calling it directly, not just the admin route.
- The inline comment immediately above the cron's call site (`// PR-N1 follow-up: rows that aged past the resolver window stay pending forever unless explicitly regraded. Fail-soft — never fail the grading run.`) already documented the *intent* of the automatic call — the module's own top-of-file comment just never caught up.
- Both call sites confirmed to exist: `src/app/api/admin/nighthawk/regrade-stuck-outcomes/route.ts` (admin, on-demand) and `src/app/api/cron/nighthawk-outcomes/route.ts` (automatic, nightly).

### Fix rationale

Doc-only change: corrected the header comment to state both invocation paths (admin route AND
automatic nightly cron), and removed the two now-false "admin-only"/"silent every-boot sweep"
claims while keeping the accurate bounded/idempotent/fail-soft safety guarantees the rest of the
comment (correctly) describes. No behavior touched — the underlying selector/regrade logic is
unchanged and all 11 existing `regrade-stuck.test.ts` tests still pass. `npx tsc --noEmit` clean.

### Blast radius

Comment-only, single file. No other call site or consumer references this specific claim.

Shipped as PR #5040, merged and content-verified on `main`.
