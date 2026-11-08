> **kind:** FINDING

## Seven admin reporting/ops routes imported `NO_STORE_HEADERS` but never applied it — FIXED

| | |
|---|---|
| **Area** | Admin dashboard/ops API routes (Night Hawk analytics/publish-preview/regrade, Playbook FSM/promotion report, 0DTE Command health/regrade) |
| **Status** | FIXED (this PR) |
| **Files** | `src/app/api/admin/nighthawk/analytics/route.ts`, `src/app/api/admin/nighthawk/publish-preview/route.ts`, `src/app/api/admin/nighthawk/regrade-stuck-outcomes/route.ts`, `src/app/api/admin/playbook/fsm-today/route.ts`, `src/app/api/admin/playbook/promotion-report/route.ts`, `src/app/api/admin/zerodte/health/route.ts`, `src/app/api/admin/zerodte/regrade-index-roots/route.ts` |

### Root cause

Each of these seven routes `import { NO_STORE_HEADERS } from "@/lib/no-store-headers"` but every
actual `NextResponse.json(...)` call in the file set a bare `{ "Cache-Control": "no-store" }`
literal (or, on several error branches, no cache header at all) instead of spreading/using the
imported constant. Per `NO_STORE_HEADERS`'s own doc comment (`src/lib/no-store-headers.ts`), the
load-bearing headers for Cloudflare are `CDN-Cache-Control: no-store` and
`Cloudflare-CDN-Cache-Control: no-store` — a Cloudflare cache rule with `override_origin` can still
edge-cache a response that sets only plain `Cache-Control`, exactly as documented in CLAUDE.md's
"Access reality" item 5/6 (the `/robots.txt` and auth-chrome edge-cache incidents).

This is the **same defect, same root cause**, as the one found and fixed twice before:
- `admin/analytics/x/route.ts` and `admin/spx/health/route.ts`, 2026-08-01 audit (PR #1496).
- `admin/gex/health/route.ts`, `admin/helix/health/route.ts`, `admin/cron-health/route.ts`,
  `admin/options-socket/route.ts`, 2026-11-01 audit.

That 2026-11-01 finding doc
(`docs/audit/findings-staging/2026-11-01-admin-health-routes-missing-cdn-nostore-headers.md`)
explicitly named these exact seven routes as carrying the same latent defect and deliberately left
them unfixed at the time ("left for a dedicated pass by the owning lane") because they sat inside
that round's exclusion list. This PR is that dedicated pass.

The existing general-purpose guard (`src/lib/no-store-headers.guard.test.ts`) only asserts that a
route file *imports* the constant somewhere — it has no way to tell a real usage from a dead
import, which is exactly how all seven of these shipped broken (and stayed broken through two prior
audit rounds that fixed sibling routes with the identical bug) without the guard ever firing.

### Evidence

Confirmed live in the pre-fix `main` tree by reading all seven route files: each imports
`NO_STORE_HEADERS`, none ever reference the identifier outside its own import line (mechanically
verified with a small script that parses each route's `@/lib/no-store-headers` import and checks
whether any imported name re-appears in the rest of the file).

A new scoped regression test,
`src/app/api/admin/no-store-headers-admin-nighthawk-playbook-zerodte.guard.test.ts`, asserts these
seven specific routes (a) import the constant and (b) never contain a bare
`"Cache-Control": "no-store"` literal anywhere in the file (stronger than just "the constant is
used somewhere once" — several of these routes have 2-4 separate `NextResponse.json(...)` call
sites across success/400/404/502 branches, and a regression could reintroduce the literal on any
one of them while still satisfying a weaker "used once" check).

RED→GREEN proven locally: `git stash` to revert the seven route files to their pre-fix `main`
content (keeping only the new test file, restored from the stash's untracked tree) makes the new
test fail with
`admin/nighthawk/analytics/route.ts: still sets a bare { "Cache-Control": "no-store" } literal...`;
restoring the fix (`git stash pop`) makes it pass. Also re-ran the pre-existing
`src/lib/no-store-headers.guard.test.ts` and
`src/app/api/admin/no-store-headers-admin-health.guard.test.ts` (the 2026-11-01 sibling fix's own
regression guard) — both still pass, confirming this fix didn't regress either prior guard.

### Blast radius

Fixed in this PR, all seven routes named above — every `NextResponse.json(...)` call site in each
file (success path and every error branch: 400s, 404, 502) now uses the real `NO_STORE_HEADERS`
constant rather than a hand-rolled literal or no cache header at all.

**Also swept and found clean** (part of the same "import but never use" bug class, checked
mechanically across every `src/app/api/**/route.ts` that imports from `@/lib/no-store-headers`):
- `admin/apis/stream/route.ts`, `market/flows/stream/route.ts`, `market/vector/stream/route.ts` —
  each imports both `NO_STORE_HEADERS` and `NO_STORE_STREAM_HEADERS` but only applies
  `NO_STORE_STREAM_HEADERS` to its SSE response; the unused `NO_STORE_HEADERS` import is dead code,
  not a cache-hygiene bug (the route correctly uses the stream variant it actually needs).
- Every other of the ~180 files importing `NO_STORE_HEADERS`/`NO_STORE_STREAM_HEADERS` under
  `src/app/api` actually spreads the constant into a real response.

**Not fixed here — deliberately out of scope for this round:**
- `src/app/api/market/spx/pulse/stream/route.ts` — the same defect, already owned by a separate
  open PR (#7569) from the prior audit round; touching it here would race that PR.
- `src/app/api/market/zerodte/marks/stream/route.ts` — imports BOTH `NO_STORE_HEADERS` and
  `NO_STORE_STREAM_HEADERS` and uses neither (sets a bare `Cache-Control: no-cache` literal on its
  SSE response, missing the CDN-scoped headers same as the fixed routes above). Left unfixed and
  flagged rather than fixed on a judgment call: this route streams live option marks directly into
  the 0DTE/Night Hawk board (closer to trading-domain-adjacent live data plumbing than the seven
  admin reporting/ops routes fixed here, which only serve admin dashboards), so it's named here for
  the owning lane rather than guessed at.

### Fix rationale

Same fix as both precedents: replace every bare `{ "Cache-Control": "no-store" }` literal (and
every bare no-headers error response) with the actual `NO_STORE_HEADERS` constant. Left the
existing import-presence guard (`src/lib/no-store-headers.guard.test.ts`) and the 2026-11-01 sibling
guard (`src/app/api/admin/no-store-headers-admin-health.guard.test.ts`) untouched — both still pass
unmodified — and added a new, separately-scoped test for these seven routes rather than widening
either existing one, matching the precedent's own stated rationale for not expanding guard scope.
No business/domain logic in any of these seven routes was touched — only the `headers:` option on
each `NextResponse.json(...)` call.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PzDkDzjR3bJQsFbXENzsVz
