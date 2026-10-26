## Backslash bypass of the sign-in/sign-up open-redirect guard (`isSafeAppRelativePath`)

> **kind:** FINDING

**File:** `src/lib/clerk-redirect-url.ts`

### Root cause

`isSafeAppRelativePath(raw)` is the open-redirect guard used by `clerkPostAuthReturnPath` (the
function that decides where `/sign-in` and `/sign-up` send the user after a successful Clerk
auth) and by `clerkStagingReturnPath`. It previously read:

```ts
export function isSafeAppRelativePath(raw: string): boolean {
  return raw.startsWith("/") && !raw.startsWith("//");
}
```

This treats any string starting with a single `/` as a safe, same-origin path — but a leading
`/` followed by a **backslash** is not safe. Per the WHATWG URL spec, a backslash is normalized
to a forward slash when a relative reference is resolved against an http(s) base, so
`/\evil.com` and `/\/evil.com` both open a new *authority* (host) component exactly like a
literal `//evil.com` would, even though neither begins with two literal `/` characters.
Confirmed live in this sandbox (Node 20, the same WHATWG `URL` implementation browsers use):

```
new URL("/\\evil.com", "https://blackouttrades.com").origin === "https://evil.com"
```

`isSafeAppRelativePath("/\\evil.com")` returned `true` under the old code — exactly backwards
from its own documented contract ("False for … `//evil.com` …").

### Evidence

Before the fix, `clerkPostAuthReturnPath("/\\evil.com/secret")` returned `"/secret"` (host
silently dropped during the OLD code's own path-stripping step, not rejected) and
`clerkPostAuthReturnPath("/\\/evil.com/phish")` returned `"/phish"` — neither hit the function's
own `CLERK_DEFAULT_POST_AUTH_PATH` fallback that every other open-redirect variant
(`https://evil.com`, `//evil.com`) already correctly hits. Added two tests
(`isSafeAppRelativePath: rejects backslash-based host-jump bypasses`,
`clerkPostAuthReturnPath: rejects backslash-based host-jump bypass end-to-end`) in
`src/lib/clerk-redirect-url.test.ts` that fail on the pre-fix code (`'/secret' !== '/'`,
`'/phish' !== '/'`) and pass after the fix. Full suite: 14/14 pass post-fix.

### Blast radius

`isSafeAppRelativePath` has exactly two internal call sites today
(`clerkStagingReturnPath`'s own branch and `clerkSanitizeStagingReturnUrl`'s branch), both of
which happen to re-derive `pathname + search` from a parsed `URL` object immediately afterward —
so today's two consuming code paths (`/sign-in`, `/sign-up`, `middleware-clerk.ts`'s signed-in
redirect, `AuthSignedInRedirect.tsx`, `clerk-env.ts`'s satellite redirect) never actually hand an
attacker-controlled *origin* back to a caller; the backslash input degraded to a same-origin
path (`"/"` or `"/secret"`), not a redirect to `evil.com`. The real risk is latent: the function
is `export`ed with a public safety contract ("True for same-app paths … false for anything that
escapes this origin"), already has a dedicated unit test asserting that contract
(`isSafeAppRelativePath: only same-app paths`), and is the kind of helper a future caller reaches
for directly, trusting its name, without re-deriving pathname+search as a second guard. Fixing it
at the source closes the gap before a new call site can ever be exploitable, rather than relying
on every future caller independently reinventing the same incidental protection.

### Fix rationale

Resolve `raw` against a fixed sentinel base (`http://same-origin.invalid`) via the real `URL`
parser and require the resulting `.host` to be unchanged, instead of a literal-prefix string
check. This uses the same WHATWG algorithm a browser uses to resolve the redirect, so it can't be
out of sync with what actually happens at the network/browser layer — it's not a second bespoke
parser that could itself drift from spec. A percent-encoded backslash (`/%5Cevil.com`) is
correctly still treated as safe: percent-encoding is never decoded into a path separator by the
URL parser (or by a browser navigating a `Location` header), so there is no equivalent bypass
through encoding.

Nothing else was changed — `clerkSanitizeStagingReturnUrl`'s own absolute-URL branch (`new
URL(trimmed)` with an explicit scheme+host) was already safe, since a backslash in the *path* of
an already-fully-qualified URL does not reopen the authority component; only the relative-path
branches needed the fix.

| **Status** | **Fixed** — PR #6795 (branch `fix/clerk-redirect-backslash-bypass`), merged once CI green per standing auto-merge authorization. |
