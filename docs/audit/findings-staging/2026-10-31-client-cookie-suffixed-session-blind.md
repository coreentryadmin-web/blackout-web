> **kind:** FINDING

## Client-side Clerk cookie reads silently blind to Clerk's suffixed `__session`/`__client_uat` cookies — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 (conversion tracking + nav auth-chrome self-heal silently never fire for a real, already-reproduced-live cookie shape) |
| **Area** | Client-side auth-chrome self-heal (`Nav.tsx`, `useMarketingSignedIn`) + GA4/Google Ads conversion tracking |
| **PR** | fix/client-uat-suffixed-cookie |

### Root cause

Clerk's backend SDK (`AuthenticateContext.usesSuffixedCookies()` /
`getSuffixedOrUnSuffixedCookie()`) writes `__session_<publishableKeySuffix>` and
`__client_uat_<publishableKeySuffix>` **instead of** the bare `__session` / `__client_uat` cookie
names whenever this Clerk instance's session cookie would otherwise collide with another Clerk
instance on the same top-level domain. This is a real, currently-active mechanism that is already
**confirmed to happen live in this deployment**: PR #797 (2026-07-18) fixed a production bug
("Homepage nav stayed on Sign in for signed-in users") caused by exactly this — a signed-in
member's browser carried *only* the suffixed cookie pair, no bare names at all — and PR #7082
(open at time of writing) independently found and fixed two more bare-name-only re-implementations
of the same check inside `src/middleware-clerk.ts` (server-side, `req.cookies.has("__session")`).

Neither #797 nor #7082 touched the **client-side** (`document.cookie`) instances of the identical
bug, which is a different API entirely from `req.cookies`/`cookies()` and was never covered by
either fix:

1. **`src/lib/client-signed-in.ts`'s `readClientSignedIn()`** — matched only
   `/(?:^|;\s*)__client_uat=([^;]+)/`, a bare-name-only regex. For a suffixed-only session this
   always returns `null` (no match), which two real call sites depend on:
   - `src/components/Nav.tsx`'s `cookieSignedIn` self-heal — its own comment says this exists
     specifically because "desk content can be cookie-authed while Clerk client still reports
     signed-out → 'Sign In' over a live /nighthawk." For a suffixed-only session this self-heal
     silently never fires, leaving the site to rely solely on Clerk's client JS loading correctly.
   - `src/lib/use-marketing-signed-in.ts`'s `useMarketingSignedIn()` — the post-hydration
     "upgrade to the live cookie" effect and the live-cookie-gated `/api/auth/me` re-verification
     both silently no-op when `readClientSignedIn()` returns `null` instead of `true`. This is the
     exact same user-visible symptom #797 fixed server-side ("Homepage nav stayed on Sign in for
     signed-in users") reappearing through a different code path that was never patched.
2. **`src/lib/analytics/ga4-client.ts`'s `hasSessionCookie()`** — checked
   `document.cookie.includes("__session=")`, a bare-name substring match with the identical blind
   spot (a cookie named `__session_AbCdEf12=...` does not contain the substring `"__session="`).
   This gates three real conversion-tracking fires in `src/components/analytics/Ga4Attribution.tsx`:
   the GA4 `sign_up` event on `/upgrade`, the Google Ads `signup` conversion (fired off the same
   gate), and the `desk_opened` GA4 event on any desk page. For a signed-in member whose browser
   carries only the suffixed session cookie, all three silently never fire — a signup conversion
   is lost with no error, no log, nothing to notice.

### Evidence

- `node_modules/@clerk/backend/dist/internal.js` (`usesSuffixedCookies()` /
  `getSuffixedOrUnSuffixedCookie()`) — the SDK mechanism itself, same evidence #7082 already cited
  for the server-side instance of this bug.
- `git show eb5be79b3 -- src/middleware-clerk.ts src/lib/clerk-session-from-request.ts` (#797) —
  confirms this cookie shape is already reproduced live in this deployment, and that the fix never
  touched `src/lib/client-signed-in.ts` or `src/lib/analytics/ga4-client.ts`.
- RED→GREEN (regression tests added):
  - `src/lib/client-signed-in.test.ts` — `readClientSignedIn detects a SUFFIXED-only __client_uat
    cookie` asserted `true` for `document.cookie = "__client_uat_AbCdEf12=1700000000"`; failed with
    `null !== true` pre-fix (confirmed via `git stash` on `src/lib/client-signed-in.ts` alone),
    passes post-fix.
  - `src/lib/analytics/ga4-client.test.ts` — `hasSessionCookie detects a SUFFIXED-only __session
    cookie` asserted `true` for the same cookie shape; failed pre-fix (`false !== true`, confirmed
    via the same `git stash` technique on `src/lib/analytics/ga4-client.ts` alone), passes
    post-fix.
  - `src/lib/clerk-client-cookie.test.ts` — unit coverage for the new shared helper (bare name,
    suffixed name, absent, off-browser).
- `tsc --noEmit` clean. Full `npm test` run (Node 20) — see PR for the exact pass count.

### Blast radius

Both call sites share the identical root cause (a bare-name-only `document.cookie` presence check
that doesn't account for Clerk's suffix mechanism) in two independent files — the same "duplicated
logic in a second file" shape #7082's own write-up flagged for the server-side instances. Grepped
the repo for every `document.cookie` read (`grep -rn "document.cookie"` across `src/`) and
confirmed these are the only two Clerk-cookie-presence checks; `src/lib/experiments/client.ts`'s
generic cookie get/set is unrelated (A/B bucket assignment, not auth).

### Fix rationale

Added a new shared helper, `src/lib/clerk-client-cookie.ts` (`clerkClientCookieValue` /
`clerkClientCookiePresent`), that scans every `document.cookie` entry for an exact match on the
base name OR a `<baseName>_` prefix — the client-side mirror of what
`clerk-session-cookies.ts`/`clerk-session-from-request.ts` already do server-side for
`__session`/`__session_*`. Pointed both `readClientSignedIn()` and `hasSessionCookie()` at it
instead of re-deriving the same regex/substring check a third and fourth time, so a future
client component needing this signal reuses the fixed helper rather than reintroducing the bug.
Left the numeric-value interpretation (`parseInt` + `> 0` for `__client_uat`, bare presence for
`__session`) exactly as each caller already had it — only the cookie-name matching changed.
