> **kind:** FINDING

## `signedInFromCookieStore` missed the suffixed `__client_uat_<suffix>` cookie — the #797 bug class, re-introduced on the uat fallback path — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **File** | `src/lib/clerk-session-cookies.ts` |
| **Severity** | P3 (cosmetic UI fallback, not a security boundary) |

### Root cause

Clerk suffixes `__session` **and** `__client_uat` together — never one without the other — when
this app's session cookie name collides with another Clerk instance on the same top-level domain
(`usesSuffixedCookies()`/`getSuffixedOrUnSuffixedCookie()` in `@clerk/backend`). This repo hit that
exact scenario in production once already (#797 — "a signed-in member's browser carried ONLY
`__session_<suffix>`, no bare `__session` at all — Homepage nav stayed on Sign in") and the fix was
applied to every `__session`-reading helper: `activeClerkUserIdFromCookieStore` (this same file),
`activeClerkUserIdFromRequest` (`clerk-session-from-request.ts`), and `requestHasClerkSessionCookie`
(`clerk-session-recovery.ts`) all walk `jar.getAll()` for a `__session_`/`__client_uat_`-prefixed
cookie name, not just the bare one.

`signedInFromCookieStore` (same file) is the one place that was missed. It correctly delegates the
`__session` side to the now-suffix-aware `activeClerkUserIdFromCookieStore`, but its own fallback —
checking `__client_uat` directly when no decodable `__session` JWT is found — only ever read the
bare cookie name:

```ts
export function signedInFromCookieStore(jar: Awaited<ReturnType<typeof cookies>>): boolean {
  if (activeClerkUserIdFromCookieStore(jar)) return true;
  const uat = jar.get("__client_uat")?.value;   // <-- bare name only
  if (!uat) return false;
  const v = parseInt(uat, 10);
  return Number.isFinite(v) && v > 0;
}
```

So a request whose Clerk cookies are suffixed-only (`__session_<suffix>` + `__client_uat_<suffix>`,
no bare names at all — exactly #797's shape) and whose `__session_<suffix>` JWT doesn't decode here
(e.g. mid-refresh, or any other reason `activeClerkUserIdFromSessionCookie` returns null) falls
through to a `__client_uat` check that is blind to the suffix mechanism it is specifically meant to
catch. `requestHasClerkSessionCookie`, which exists to answer the identical question
("does this request carry a Clerk session signal for this exact `__session`/`__client_uat` pair")
already handles both prefixes correctly in `clerk-session-recovery.ts` — this file simply never got
the same treatment when #797 was fixed elsewhere.

### Evidence

Added two tests to `src/lib/clerk-session-cookies.test.ts` (sibling to the existing
`__client_uat`-only tests):

```
test("true when only suffixed __client_uat_<suffix> is present", ...)
test("false when only suffixed __client_uat_<suffix>=0 is present", ...)
```

RED (`git stash` on `src/lib/clerk-session-cookies.ts` alone, test file kept): the first new test
failed — `false !== true` — confirming `signedInFromCookieStore` read a suffixed-only
`__client_uat_<suffix>=1700000000` jar as signed-out. GREEN after the fix: `npx tsx
--experimental-test-module-mocks --test src/lib/clerk-session-cookies.test.ts` — 5/5 pass. Also ran
the only other consumer test touching this file (`src/app/native-signin/route.test.ts`) — unaffected,
7/7 pass combined. `npx tsc --noEmit` clean.

### Blast radius

One call site: `signedInFromRequestCookies()` → `src/app/(site)/layout.tsx`'s `initialSignedIn`
fallback, used only when `auth()` itself returned no `userId` (the layout's own comment: "fails
open... this is cosmetic, so it fails open" — it only drives the shared `<Nav>`'s Sign-in-vs-Open-desk
chrome and the desk-sidebar/tab-bar render, not any page or API access boundary — those gate
independently via `auth()`/`requireTierApi`/`isCronAuthorized`, none of which read `__client_uat` at
all). No other caller of `signedInFromCookieStore` exists. `activeClerkUserIdFromRequestCookies`
(the sign-in/sign-up pages' redirect-when-already-signed-in check) calls
`activeClerkUserIdFromCookieStore` directly, not `signedInFromCookieStore`, and was already
suffix-aware — unaffected by this bug and unaffected by this fix.

### Fix rationale

Extracted the existing bare-`__client_uat` parse/validate logic into a small `isActiveUatValue`
helper and applied it to both the bare name and every `getAll()`-enumerated cookie whose name starts
with `__client_uat_` (excluding the bare name itself, mirroring the exact prefix-walk shape already
used by `activeClerkUserIdFromCookieStore` in the same file and `requestHasClerkSessionCookie` in
`clerk-session-recovery.ts`), so all three suffix-aware checks in this app now share the identical
pattern instead of two of them having it and one missing it. Deliberately left unchanged: the
`activeClerkUserIdFromCookieStore`/`activeClerkUserIdFromRequestCookies` path (already correct), and
every actual auth/tier gate (`auth-server.ts`, `market-api-auth.ts`, `admin-access.ts`) — none of
them read `__client_uat` at all, so this fix only touches the cosmetic nav-fallback signal, per the
layout's own documented "fails open" design.
