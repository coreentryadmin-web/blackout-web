> **kind:** FINDING

## Four admin status/health routes imported `NO_STORE_HEADERS` but never applied it — FIXED

| | |
|---|---|
| **Area** | Admin dashboard API routes (GEX health, HELIX health, cron health, options-socket status) |
| **Status** | FIXED (PR, this round) |
| **Files** | `src/app/api/admin/gex/health/route.ts`, `src/app/api/admin/helix/health/route.ts`, `src/app/api/admin/cron-health/route.ts`, `src/app/api/admin/options-socket/route.ts` |

### Root cause

Each route `import { NO_STORE_HEADERS } from "@/lib/no-store-headers"` but the actual
`NextResponse.json(...)` call set a bare `{ "Cache-Control": "no-store" }` literal instead of
spreading/using the imported constant. Per `NO_STORE_HEADERS`'s own doc comment
(`src/lib/no-store-headers.ts`), the load-bearing headers for Cloudflare are
`CDN-Cache-Control: no-store` and `Cloudflare-CDN-Cache-Control: no-store` — a Cloudflare cache
rule with `override_origin` can still edge-cache a response that sets only plain
`Cache-Control`, exactly as documented in CLAUDE.md's "Access reality" item 5/6 (the `/robots.txt`
and auth-chrome edge-cache incidents).

This is the **same defect, same root cause**, as the one found and fixed in
`admin/analytics/x/route.ts` and `admin/spx/health/route.ts` by the 2026-08-01 audit
(commit `6d6c3f6f7` / PR #1496). That fix's own commit message says explicitly:

> "The guard's import-only check can't catch that class of bug; noted as a known test-design
> limitation in FINDINGS.md rather than expanding scope to rewrite the guard itself."

Tracing further back (commit `15722f39c` / PR #1224, 2026-07-29), the `NO_STORE_HEADERS` import
was added to all four of `admin/cron-health`, `admin/gex/health`, `admin/helix/health` AND
`admin/spx/health` in the same commit — but only `admin/spx/health` (and separately
`admin/analytics/x`) ever got the actual usage fix on 2026-08-01. The three GEX/HELIX/cron-health
siblings — plus `admin/options-socket/route.ts` (which picked up the same dead import
independently) — were never swept, and have carried the dead import (and the real edge-cache
exposure) for three months.

### Evidence

`src/lib/no-store-headers.guard.test.ts`'s own existing test only asserts the file *imports*
`NO_STORE_HEADERS` somewhere — it has no way to tell a real usage from a dead import, which is
exactly how this shipped broken the first time and stayed broken for the three sibling routes.
Confirmed live in the current `main` tree (before this fix) by reading all four route files: each
imports the constant, each ignores it in the actual `headers:` option.

A new scoped regression test,
`src/app/api/admin/no-store-headers-admin-health.guard.test.ts`, asserts these four specific routes
spread the real constant rather than a bare literal. RED→GREEN proven locally: reverting
`admin/gex/health/route.ts` to its pre-fix body makes the new test fail with
`admin/gex/health/route.ts: imports NO_STORE_HEADERS but a response never applies it`; restoring
the fix makes it pass.

### Blast radius

Fixed in this PR: `admin/gex/health`, `admin/helix/health`, `admin/cron-health`,
`admin/options-socket`.

**Not fixed here — same latent defect, left for a dedicated pass by the owning lane** because they
sit inside actively-worked areas this round's exclusion list keeps clear of: `admin/nighthawk/analytics`,
`admin/nighthawk/publish-preview`, `admin/nighthawk/regrade-stuck-outcomes`,
`admin/playbook/fsm-today`, `admin/playbook/promotion-report`, `admin/zerodte/health`,
`admin/zerodte/regrade-index-roots`, `market/spx/pulse/stream`, `market/zerodte/marks/stream`.
Each of these imports a no-store constant but never applies it to its response, by the same
quick check: `grep` for the import, then verify the identifier reappears outside the import line.
Flagging for round 227 / the owning lane rather than fixing directly, per this round's hard
exclusion list (SPX/zerodte/Night-Hawk-adjacent areas).

### Fix rationale

Same fix as the precedent (`admin/analytics/x`, `admin/spx/health`): replace the bare
`{ "Cache-Control": "no-store" }` literal with the actual `NO_STORE_HEADERS` constant (spread where
other header keys are also set), and apply it to the error-path response too (previously the
`catch` branches on all four routes had *no* cache headers at all). Left the existing
import-presence guard (`src/lib/no-store-headers.guard.test.ts`) untouched — widening it to a
repo-wide "import must be used" check is explicitly out of scope here (it would also need to
cover/exempt the nine routes named above, which belong to other lanes), so a narrower, scoped test
was added instead that only locks in the four routes actually fixed.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PzDkDzjR3bJQsFbXENzsVz
