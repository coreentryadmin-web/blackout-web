> **kind:** FINDING

## `POST /api/auth/native-oauth/complete`'s `splitCookieHeader` silently truncates any cookie value containing a second `"="` — FIXED

| **Status** | Fixed |
|---|---|

**Found by:** DISCOVERY-lane correctness sweep (round 285), widening past the x-intel priority
area into a fresh, non-excluded, previously-unaudited file: `src/app/api/auth/native-oauth/complete/route.ts`.

**Root cause:** the route turns the Clerk bridge's single `cookieHeader` string
(`"__session=<jwt>; __client_uat=<epoch>"`) into individual `Set-Cookie` header values with:

```ts
const [name, value] = kv.split("=");
return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax`;
```

`String.prototype.split("=")` on a pair whose VALUE itself contains a `"="` produces MORE than two
elements, and destructuring only the first two silently drops everything after the second `"="`:

```
"session=abc.def=ghi".split("=")  ===  ["session", "abc.def", "ghi"]
const [name, value] = [...]       -->  name="session", value="abc.def"   ("=ghi" vanishes, no error)
```

This repo already has the correct pattern for exactly this problem, in a sibling file written for
the same reason: `src/lib/clerk-client-cookie.ts`'s `clerkClientCookieValue()` deliberately finds
the FIRST `"="` with `indexOf` and slices around it, with a doc comment explaining why a naive
`split` is wrong for a cookie pair. `splitCookieHeader` is the same shape of helper (split one
`"k=v; k2=v2"` string into individual cookie assignments) reintroducing the exact bug the other
file was written to avoid — the "second independent implementation of a one-rule concept drifts"
failure class this codebase's own `capture-guard.ts` and others are explicit about avoiding.

**Blast radius / why it's not visibly broken today:** this is the ONLY call site of
`splitCookieHeader` (grep-confirmed), and its only caller's `cookieHeader` currently ever carries
exactly two cookies: a Clerk `__session` JWT and a bare `__client_uat` epoch integer. JWTs are
three base64url segments joined by dots, and JWS base64url encoding omits `"="` padding by
definition (RFC 7515 §2), so a real Clerk session JWT never contains `"="`; `__client_uat` is a
plain integer. That is why this has not produced an observed symptom in production — but
`splitCookieHeader` is a general-purpose cookie-header splitter, not something scoped to "values
that happen not to contain `=`", and it would corrupt the `Set-Cookie` header (truncating the
session value, breaking sign-in) the moment either side of that assumption changes — a future
cookie value containing `"="`, or a provider whose token format isn't padding-free. The bug is
real and silent (no error, no log, just a shorter string) even though today's two inputs happen not
to trigger it.

**Fix:** rewrite `splitCookieHeader` to split on the FIRST `"="` only (`indexOf` + `slice`),
matching `clerk-client-cookie.ts`'s established pattern exactly, and export it from the route
(`export function splitCookieHeader`) so it is directly unit-testable rather than only reachable
through the full route's mocked end-to-end test.

**Evidence (RED → GREEN):** extended `src/app/api/auth/native-oauth/complete/route.test.ts` (the
existing test file for this route) with 3 new cases:
1. A direct unit test of `splitCookieHeader("session=abc.def=ghi; __client_uat=123")` asserting
   the full value (`abc.def=ghi`) survives, not the truncated `abc.def`.
2. A no-regression unit test on an ordinary `"="`-free value.
3. An end-to-end test (via the route's existing `mock.module` harness, with the mocked bridge
   returning a `cookieHeader` containing `"="` in its value) asserting the actual `Set-Cookie`
   response header carries the full, untruncated value.

RED (pre-fix `route.ts`, fix stashed, new tests kept): `npx tsx --experimental-test-module-mocks
--test route.test.ts` → **6 pass / 3 fail** (exactly the 3 new assertions; the 6 pre-existing
tests for rate-limiting/body-size/happy-path are unaffected).
GREEN (post-fix, same command): **9/9 pass.**
`npx tsc --noEmit`: clean.

**Note on the new tests' own correctness:** the first attempt placed the new unit test's
`splitCookieHeader` import as a top-level `import` statement. That eagerly loaded the real
(unmocked) `route.ts` — and therefore its real `ip-rate-limit.ts`/`verify-id-token.ts`/
`clerk-bridge.ts` dependencies — BEFORE the file's own `mock.module()` calls further down ever ran,
breaking the 3 pre-existing mocked tests (confirmed: reverting just that one import change restored
them to green). Fixed by importing `splitCookieHeader` dynamically inside each test
(`await import("./route.ts")`), the same pattern the file's pre-existing tests already use for
`POST` and for exactly this reason (module-mock ordering, not a style preference).
