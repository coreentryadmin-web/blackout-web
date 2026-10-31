> **kind:** FINDING

## Clerk suffixed-only session cookie caused spurious 401 on every `/api/*` mutation — FIXED

**Status:** Fixed, regression test added (`src/lib/clerk-session-recovery.test.ts`).

### Root cause

Clerk's own SDK (`@clerk/backend`'s `AuthenticateContext.usesSuffixedCookies()` /
`getSuffixedOrUnSuffixedCookie()`, `node_modules/@clerk/backend/dist/internal.js`) writes
`__session_<publishableKeySuffix>` / `__client_uat_<publishableKeySuffix>` **instead of** the
bare `__session` / `__client_uat` names whenever this instance's session cookie collides with
another Clerk instance on the same top-level domain. This is a real, currently-active SDK
mechanism, not legacy/dead code, and it is already **confirmed to actually happen in this
deployment** — PR #797 (2026-07-18, `eb5be79b3`) fixed a live production bug ("Homepage nav
stayed on Sign in for signed-in users") caused by exactly this: a signed-in member's browser
carried **only** `__session_<suffix>`, with no bare `__session` cookie present at all.

#797 fixed the sign-in-page redirect check (now `activeClerkUserIdFromRequest()` in
`src/lib/clerk-session-from-request.ts`, which correctly scans both the bare name and any
`__session_*` cookie) and the equivalent read path in `src/lib/clerk-session-cookies.ts`. It did
**not** touch two other call sites in `src/middleware-clerk.ts` that independently re-implemented
a bare-name-only presence check: `req.cookies.has("__session") || req.cookies.has("__client_uat")`.

The more impactful of the two is the **mutation guard** (not staging-gated — runs on every
request in production):

```ts
if (MUTATION_METHODS.has(req.method) && req.nextUrl.pathname.startsWith("/api/") && ...) {
  const hasClerkCookie = req.cookies.has("__session") || req.cookies.has("__client_uat");
  if (!hasBearerToken(req) && !hasClerkCookie) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
```

For a member whose browser carries **only** the suffixed cookie pair (the exact, confirmed-live
#797 scenario — Clerk's backend SDK also suffixes `__client_uat` in lockstep with `__session`
once `usesSuffixedCookies()` is true, per `initCookieValues()`), both `has("__session")` and
`has("__client_uat")` return `false`. A web browser never sends an `Authorization: Bearer ...`
header, so `hasBearerToken(req)` is also `false`. The request is rejected with a spurious `401
Unauthorized` — **even though the user is genuinely signed in**, as proven by the fact that
`auth.protect()` (which runs a few lines earlier in the same middleware function, via Clerk's own
suffix-aware SDK logic) had already let the request through to this point without throwing.

The second, staging-only instance of the same pattern gates the `__clerk_synced` sync-failure
retry redirect — a suffixed-only session there would be bounced into an unnecessary Clerk
satellite sign-in retry loop instead of being recognized as already signed in.

### Evidence

- `node_modules/@clerk/backend/dist/internal.js` lines ~1088-1122/1209-1237:
  `usesSuffixedCookies()`/`getSuffixedOrUnSuffixedCookie()` show the SDK itself treats
  `__session_<suffix>`/`__client_uat_<suffix>` as the live session for this exact scenario —
  confirming `auth()`/`auth.protect()` correctly authenticate a suffixed-only request, which is
  what makes the middleware's own separate bare-name check provably wrong (it disagrees with the
  SDK call three lines above it in the same function).
- `git show eb5be79b3 -- src/middleware-clerk.ts` — #797's own diff shows it fixed the
  `isAuthPage` redirect's cookie read (`activeClerkUserIdFromSessionCookie(req.cookies.get(
  "__session")?.value)` → `activeClerkUserIdFromRequest(req)`) but left the two
  `req.cookies.has("__session") || req.cookies.has("__client_uat")` checks lower in the same file
  untouched — this finding closes that gap.
- RED→GREEN: added
  `requestHasClerkSessionCookie detects a SUFFIXED-only session (real #797 scenario)` to
  `src/lib/clerk-session-recovery.test.ts`, asserting `true` for a request carrying only
  `__session_AbCdEf12=...; __client_uat_AbCdEf12=...}` (no bare names). Confirmed RED on the
  pre-fix function (`git stash` on `src/lib/clerk-session-recovery.ts` alone), GREEN after.

### Blast radius

`requestHasClerkSessionCookie()` (`src/lib/clerk-session-recovery.ts`) is a single shared helper
already imported into `src/middleware-clerk.ts` and already used correctly at the top of the
middleware (line ~73, gating the proactive `auth()` stale-cookie catch). The two other call sites
in the same file had silently re-implemented the identical bare-name-only logic inline instead of
reusing it. Fixing the shared helper to also recognize the suffixed variants, and pointing both
inline call sites at it, closes all three gaps with one change — no other file duplicates this
check (grepped the repo for the literal `req.cookies.has("__session")` pattern).

### Fix rationale

Extended `requestHasClerkSessionCookie()` to also return `true` when any cookie on the request
starts with `__session_` or `__client_uat_` (the two prefixes Clerk's own SDK suffixes), after the
existing bare-name check. This keeps the function's role unchanged — a cheap, JWT-validity-blind
presence signal used only to avoid spuriously treating a cookied request as "never signed in"; it
is explicitly **not** a substitute for real authentication, which both call sites still get
downstream from `auth.protect()` (middleware) and each route handler's own Clerk check. Making the
presence check more permissive therefore cannot weaken authorization — it only removes false
negatives that were producing user-visible 401s for genuinely authenticated requests. Replaced the
two duplicated inline checks in `src/middleware-clerk.ts` with calls to the now-fixed shared
helper rather than re-deriving the suffix logic a third time.

Left `__clerk_db_jwt` untouched (bare-only) in `CLERK_SESSION_COOKIE_NAMES` — it is not part of
Clerk's suffixing mechanism (confirmed in the same SDK source), so suffix-matching it would be
speculative rather than evidence-based.
