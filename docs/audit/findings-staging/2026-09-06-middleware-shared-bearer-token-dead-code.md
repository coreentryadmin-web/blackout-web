## 2026-09-06 — [FINDING, middleware, P3] Security-relevant `hasBearerToken` check duplicated (unused shared copy + inline reimplementation), plus 3 more dead exports — FIXED

> **kind:** `FINDING`

### Symptom

Follow-up from an earlier DISCOVERY-lane sweep of `src/middleware.ts`/`src/middleware-shared.ts`
this session, which flagged several unused exports in `middleware-shared.ts` as worth a closer,
more careful look given they're auth/security-adjacent code — deferred at the time rather than
fixed on the same pass. Investigated and fixed this cycle.

### Root cause

`middleware-shared.ts` exported `hasBearerToken(req)` — a byte-identical duplicate of a check
`middleware-clerk.ts` computed **inline** instead of importing:

```ts
// middleware-shared.ts (exported, zero callers anywhere)
export function hasBearerToken(req: NextRequest): boolean {
  const bearer = req.headers.get("authorization") ?? "";
  return bearer.startsWith("Bearer ") && bearer.length > 27;
}

// middleware-clerk.ts (the actual, live mutation-guard check — recomputed the same logic locally)
const bearer = req.headers.get("authorization") ?? "";
const hasBearerToken = bearer.startsWith("Bearer ") && bearer.length > 27;
```

This is the same "two near-duplicate implementations of the same logic" bug class fixed
repeatedly elsewhere this session, here on a security-relevant path: the mutation guard that
rejects any unauthenticated POST/PUT/PATCH/DELETE to `/api/*`. Both copies happened to agree today
(verified byte-for-byte), but nothing enforced that — if the Bearer-token length threshold or
prefix were ever tightened in one copy (e.g. in response to a real incident), the other would
silently stay stale, and `middleware-shared.ts`'s copy — the one that reads as "the" definition —
was the one nobody was actually calling.

Also confirmed dead (zero callers anywhere, verified via grep before/after) in the same file:
- `middlewareConfig` — a second, unused, hand-maintained copy of the matcher literal actually used
  in `src/middleware.ts`. `middleware.ts`'s own comment already explains why it can't import this
  (`"Next.js cannot analyze re-exported middleware config"`) — so this copy was inert twice over:
  unusable by its intended purpose *and* unused by anything else.
- `isProtectedPath(pathname)` — an unused wrapper around `PROTECTED_PREFIXES` (which is itself
  still live and used elsewhere — untouched).
- `isWebhookPath(pathname)` + `WEBHOOK_PREFIXES` — unused; `middleware-clerk.ts` detects webhook
  routes via its own local `createRouteMatcher(["/api/webhook/(.*)", "/api/webhooks/(.*)"])`
  instead, a different (Clerk-matcher) mechanism for the same two static prefixes. Low realistic
  drift risk (2 literal strings, unlikely to change), so left as-is rather than also refactoring
  that matcher to consume the shared array — kept this fix scoped to the confirmed dead exports.

`isAuthExemptPath` was deliberately left untouched — its own comment documents it as intentionally
kept "for API stability" despite being permanently `false` and unused, matching the same
kept-for-reference pattern already respected elsewhere this session (e.g. `thermalDiscordCaption`
in the Thermal desk).

### Fix

`middleware-clerk.ts` now imports and calls the shared `hasBearerToken(req)` instead of
recomputing it inline — one implementation, not two, on a security-relevant path. Removed the
three confirmed-dead exports (`middlewareConfig`, `isProtectedPath`, `isWebhookPath` +
`WEBHOOK_PREFIXES`) from `middleware-shared.ts`.

### Evidence

- RED→GREEN: `git stash push -- middleware-clerk.ts middleware-shared.ts` (keeping the new test
  file) → drift-guard test fails against the old inline duplicate → `git stash pop` → 5/5 pass.
- New `middleware-shared.test.ts`: direct behavioral tests of `hasBearerToken` (valid token,
  missing header, wrong scheme, too-short token) plus a **source-scan drift guard** asserting
  `middleware-clerk.ts` imports the shared function rather than locally redefining it — the same
  class of guard used for the SPX King-node and Nav/DeskSidebar fixes earlier this session.
- `grep -rn` for each removed symbol, repo-wide, before/after: definition-only → zero matches.
- `npx tsc --noEmit`: clean.
- Full `npm test` (Node 20): see PR for final count.

### Blast radius

`src/middleware-clerk.ts` (1 import added, inline duplicate replaced with a call — the mutation
guard's actual runtime behavior is unchanged, verified byte-identical logic before and after) and
`src/middleware-shared.ts` (3 dead exports removed). New `src/middleware-shared.test.ts`. No other
consumer of any removed symbol exists.

| **Status** | FIXED — PR opened, merge pending CI/peer-review per standing policy |
