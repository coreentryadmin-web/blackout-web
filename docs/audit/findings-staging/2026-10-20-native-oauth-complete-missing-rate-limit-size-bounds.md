> **kind:** FINDING

## `POST /api/auth/native-oauth/complete` had no rate limit or body/field-size bounds — FIXED

| **Status** | FIXED |
|---|---|

**Symptom:** `src/app/api/auth/native-oauth/complete/route.ts` — the public (necessarily
unauthenticated, it IS the sign-in path) endpoint the iOS Capacitor app calls after a native
Sign in with Google/Apple sheet returns an identity token — was the one public, mutating route
in this codebase with neither a per-IP rate limit nor any bound on request-body size or
individual field lengths. Every other public route here (`src/app/api/public/email-capture`,
`src/app/api/telemetry/client-error`, `src/app/api/telemetry/auth-failure`) follows the same
two-part discipline: a `checkIpRateLimit` cap, and a `Content-Length`/`raw.length` cap checked
*before* any parsing or real work. This route had neither.

**Root cause:** found during a DISCOVERY-lane sweep for public routes missing the established
size/rate-limit convention. The route accepted an arbitrary-length `idToken` (and `rawNonce`,
`fallbackEmail`, `fallbackName`) straight from `req.json()` with no `Content-Length` pre-check,
no raw-body-length check, and no per-field length validation, then fed `idToken` directly into
`verifyGoogleIdToken`/`verifyAppleIdToken`, which calls `jose`'s `jwtVerify()`. `jwtVerify()` still
base64-decodes and `JSON.parse`s the token's header/payload sections *before* signature
verification can reject a hostile string — so an arbitrarily large `idToken` did real
(bounded-per-call, but uncapped-in-aggregate) decode/parse work with zero per-caller ceiling, and
a verified attempt additionally reaches Clerk Backend API calls (`mintClerkSessionFromNativeOAuth`)
with the same lack of a rate limit.

**Fix:** `src/app/api/auth/native-oauth/complete/route.ts` — switched the handler's request type
from bare `Request` to `NextRequest` and added: (1) a per-IP rate limit via `checkIpRateLimit`
(`public:native-oauth-complete`, 10/60s — tighter than the telemetry routes' 20/60s since each
call here does real signature verification plus, on success, Clerk Backend round-trips, not just
a cheap write); (2) a whole-body cap (`MAX_BODY_BYTES = 16_000`, checked via both `Content-Length`
and `raw.length` before `JSON.parse`, mirroring `telemetry/client-error`'s exact pattern); (3)
per-field length caps checked after parsing (`idToken` ≤ 8KB, `rawNonce` ≤ 256, `fallbackEmail` ≤
254 per RFC 5321, `fallbackName` ≤ 200) so a small-overall body with one implausibly long field is
still rejected before reaching `jwtVerify()`/Clerk.

**Blast radius:** single file — this route has no other caller (it's invoked only by the iOS app
over HTTP, not imported elsewhere in the codebase). The existing account-takeover-prevention logic
in `clerk-bridge.ts`'s `resolveNativeOAuthUser` (verified-email-only account selection) is untouched
— this fix only bounds *how much work an unauthenticated caller can trigger*, not the identity
resolution logic itself.

**Test:** `src/app/api/auth/native-oauth/complete/route.test.ts` (new, 6 tests) — asserts the rate
limit is checked before any verification call, a blocked rate limit returns 429 without reaching
`jwtVerify()`, an oversized body is rejected via `Content-Length` before parsing, an oversized
`idToken`/`fallbackEmail` field is rejected even inside an otherwise-small body, and a normal
small Google sign-in still succeeds end-to-end. **RED→GREEN proven**: `git stash` on `route.ts`
alone (keeping the new test file) reproduced 5/6 failures against the old behavior; restored,
6/6 pass. `npx tsc --noEmit`: clean repo-wide. Ran alongside the existing `native-oauth`/
`ip-rate-limit` test suites (19 tests total): all pass, no regressions.
