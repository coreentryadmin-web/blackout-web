> **kind:** FINDING

## `isIosNativeShellPath` doesn't strip query/hash before matching utility paths — FIXED

**Status:** Fixed, regression test added (`src/lib/ios-tool-routes.test.ts`).

### Root cause

`src/lib/ios-tool-routes.ts` exports two path-prefix matchers with the same
shape but different normalization:

```ts
function normalizeIosPath(path: string): string {
  return path.split(/[?#]/)[0] ?? path;
}

export function isIosToolRoute(path: string): boolean {
  const p = normalizeIosPath(path);
  return IOS_TOOL_ROUTES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}

export function isIosNativeShellPath(path: string): boolean {
  return IOS_NATIVE_SHELL_PATH_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );
}

export function isIosNativeShellRoute(path: string): boolean {
  if (isIosToolRoute(path)) return true;
  return isIosNativeShellPath(path);
}
```

`isIosToolRoute` (and the sibling `getIosToolMeta`/`getIosToolRouteIndex`)
strip a trailing `?query` or `#hash` via `normalizeIosPath` before matching —
`isIosToolRoute("/vector?ticker=SPY")` is `true`, and that behavior is already
covered by an existing test. `isIosNativeShellPath` — the companion matcher
for the signed-in *utility* routes (`/account`, `/faq`, `/learn`, `/upgrade`,
`/admin`) that `isIosNativeShellRoute` ORs together with `isIosToolRoute` —
never got the same treatment: it matches the raw, un-normalized `path`
directly. A utility path carrying a query string or hash (e.g.
`"/account?from=upgrade"`, `"/upgrade#plans"`, `"/admin/health?tab=cron"`)
fails BOTH the exact-match (`path === prefix`) and the prefix check
(`path.startsWith(\`${prefix}/\`)`) branches, and `isIosNativeShellPath`
wrongly returns `false` for a path that is, in fact, a native-shell route.

### Evidence

RED→GREEN proven with `git stash` on `src/lib/ios-tool-routes.ts` alone
(test file kept):

```
# before fix (git stash push -- src/lib/ios-tool-routes.ts)
# tests 14 / pass 13 / fail 1
not ok 2 - strips a query string or hash before matching utility paths
  AssertionError [ERR_ASSERTION]:
    isIosNativeShellPath("/account?from=upgrade")  → false, expected true

# after fix (git stash pop)
# tests 14 / pass 14 / fail 0
```

New test added (`isIosNativeShellRoute` describe block):

```ts
it("strips a query string or hash before matching utility paths", () => {
  assert.equal(isIosNativeShellPath("/account?from=upgrade"), true);
  assert.equal(isIosNativeShellPath("/upgrade#plans"), true);
  assert.equal(isIosNativeShellPath("/admin/health?tab=cron"), true);
  assert.equal(isIosNativeShellRoute("/account?from=upgrade"), true);
  assert.equal(isIosNativeShellRoute("/faq#billing"), true);
  // Still correctly rejects a non-native-shell path carrying a query/hash.
  assert.equal(isIosNativeShellPath("/pricing?ref=home"), false);
  assert.equal(isIosNativeShellRoute("/sign-in?redirect=/account"), false);
});
```

### Blast radius

`isIosNativeShellPath` has exactly one caller, `isIosNativeShellRoute`, which
in turn has exactly two real call sites repo-wide:
`src/hooks/useIosNativeShell.ts` and `src/components/ios/IosAppChrome.tsx`.
Both feed it `usePathname()` from `next/navigation`, which by contract never
includes a query string or hash — so in the CURRENT codebase this bug is
**confirmed unreachable in practice** (verified by grep for every call site;
flagged as such across three prior audit rounds, 141–143). No other consumer
was found. This PR fixes the function to be correct standing alone — matching
its sibling `isIosToolRoute` — rather than leaving a latent defect that would
silently misbehave the moment any future caller (a server-side check against
a raw request URL, a deep-link handler, a new native-bridge entry point that
passes `window.location.pathname + search`) is added without rediscovering
this inconsistency from scratch.

### Fix rationale

Mirrored the existing, already-tested pattern from `isIosToolRoute` exactly:
normalize the input through the same shared `normalizeIosPath` helper before
matching, rather than inventing a second normalization. This is the smallest
fix that removes the inconsistency, keeps `isIosNativeShellPath` and
`isIosToolRoute` behaviorally symmetric, and needs no change to any call
site. Nothing else in the file was touched — `IOS_NATIVE_SHELL_PATH_PREFIXES`,
`getIosHeaderMeta`'s own separate `path.split(/[?#]/)[0]` inline strip, and
every other matcher in the module were already correct and are left as-is.
