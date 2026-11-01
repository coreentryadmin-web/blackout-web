> **kind:** FINDING

## `clerkStagingReturnPath`'s relative-path branch forwarded Clerk's `__clerk_db_jwt` cross-domain session-sync token unstripped, while the sibling absolute-URL function already stripped it — FIXED

**Status:** Fixed, regression test added (`src/lib/clerk-redirect-url.test.ts`).

### Root cause

`src/lib/clerk-redirect-url.ts` has two functions that sanitize a post-auth return path for the
primary ↔ `staging.blackouttrades.com` satellite handoff, and both are supposed to agree on what
gets stripped from the query string before it is re-embedded in a new `redirect_url`:

- `clerkSanitizeStagingReturnUrl` (absolute-URL branch, present since this file's very first
  commit, #699): deletes **both** `__clerk_synced` and `__clerk_db_jwt`.
- `clerkStagingReturnPath`'s relative-path branch (`isSafeAppRelativePath(trimmed)` true): only
  deleted `__clerk_synced`. `__clerk_db_jwt` was never stripped there.

`__clerk_db_jwt` is Clerk's real primary↔satellite session-sync token carried in the URL during
the cross-domain handshake (the app's own `/cookie-policy` page calls it "development/debug... only"
but it is exactly the mechanism this satellite setup relies on for production sign-in sync, per
this file's and `clerk-env.ts`'s own doc comments) — not inert noise.

The two functions disagreeing on the exact same input is a textbook duplicated-logic-drift: a
fix (stripping `__clerk_db_jwt`) landed in one implementation at file creation and was never
mirrored into the second implementation that does the equivalent job for a relative path.

### Blast radius

`middleware-clerk.ts`'s `clerkIsClerkSyncFailed` recovery branch hits this directly: on a sync
failure it builds `clean = new URL(req.nextUrl)`, deletes only `__clerk_synced` from it, derives
`${clean.pathname}${clean.search}` as a `returnPath`, and passes that straight into
`clerkSatelliteAuthRedirect("sign-in", returnPath)` → `clerkStagingReturnPath(returnPath)`. If the
failing request's URL still carried a stale/invalid `__clerk_db_jwt` (exactly the state a failed
sync leaves it in), that token was faithfully re-embedded, unstripped, inside the `redirect_url`
query parameter of the redirect sent to the **primary** `blackouttrades.com/sign-in` page —
i.e. forwarded to a different host than the one it was minted for, in a URL that can end up in
browser history, referrer headers, and server access logs.

The identical query string, if passed as a full absolute staging URL instead of a relative path
to the same overall flow (`clerkPostAuthReturnPath` → `clerkStagingReturnPath` →
`clerkSanitizeStagingReturnUrl`), was already correctly stripped — confirming this was purely a
drift between the two code paths, not an intentional difference, and not already covered by the
other sanitizer no matter which branch a given caller happens to take.

No other field/behavior was touched: `isSafeAppRelativePath`'s backslash-bypass guard, the
protocol-relative/absolute-URL rejection, and `__clerk_synced` stripping all continue exactly as
before.

### Fix rationale

Added the missing `u.searchParams.delete("__clerk_db_jwt")` call right next to the existing
`__clerk_synced` deletion inside `clerkStagingReturnPath`'s relative-path branch, so both sanitizer
code paths strip the identical two params regardless of whether the input arrives as a bare path
or a full URL. Left `clerkSanitizeStagingReturnUrl` itself unchanged (it was already correct) and
left every other guard/rejection path in the file untouched — this is a one-line parity fix, not a
redesign.

### Evidence (RED → GREEN)

Added a test asserting the relative-path and absolute-URL inputs (same query string) must now
agree: `clerkStagingReturnPath("/sign-in?__clerk_db_jwt=deadbeef&__clerk_synced=false")` must equal
`"/sign-in"`, matching what `clerkSanitizeStagingReturnUrl` already returns for the equivalent
absolute URL.

- **RED** (pre-fix, `git stash` on just the source file with the new test present):
  `npx tsx --experimental-test-module-mocks --test src/lib/clerk-redirect-url.test.ts` → 14 pass,
  **1 fail** — `clerkStagingReturnPath` returned `/sign-in?__clerk_db_jwt=deadbeef`, leaking the
  token.
- **GREEN** (fix restored): same run → **15/15 pass**.
- Also ran `src/lib/clerk-env.test.ts` + `src/lib/clerk-session-recovery.test.ts` alongside it
  (27/27 pass combined) and `npx tsc --noEmit` (clean) to confirm no adjacent regression.
