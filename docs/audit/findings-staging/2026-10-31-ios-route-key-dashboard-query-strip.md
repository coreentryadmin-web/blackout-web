> **kind:** FINDING

## `getIosRouteKey`'s `/dashboard` branch doesn't strip query/hash before matching — FIXED

**Status:** Fixed, regression test added (`src/lib/ios-tool-routes.test.ts`).

### Root cause

`src/lib/ios-tool-routes.ts` exports several path matchers that share the
same module. `isIosToolRoute`/`getIosToolMeta`/`getIosToolRouteIndex`, and
(as of PR #7003, same file, same session) `isIosNativeShellPath`, all
normalize their input through the shared `normalizeIosPath` helper before
matching:

```ts
function normalizeIosPath(path: string): string {
  return path.split(/[?#]/)[0] ?? path;
}
```

`getIosRouteKey` — the fifth matcher in the same file, used to drive the
`data-ios-route` attribute on `<html>` — never got the same treatment:

```ts
export function getIosRouteKey(path: string): IosRouteKey {
  if (path === "/dashboard" || path.startsWith("/dashboard/")) return "dashboard";
  if (path.startsWith("/flows")) return "flows";
  ...
  return "other";
}
```

Every branch after the first is a bare `path.startsWith(prefix)`, which
happens to tolerate an un-stripped query string or hash (`"/flows?x=1"` still
starts with `"/flows"`). The `/dashboard` branch is the one exception: it
requires an EXACT match or a `startsWith(`${prefix}/`)` match — the same
stricter shape `isIosNativeShellPath` used before its #7003 fix, and for the
identical reason (avoiding a false-positive prefix collision). A query string
or hash directly on `/dashboard` itself (`"/dashboard?ref=upgrade"`,
`"/dashboard#widgets"`) fails both the exact-match and the `startsWith(
"/dashboard/")` check, falls through every remaining branch, and
`getIosRouteKey` returns `"other"` instead of `"dashboard"`.

This is the same bug class as #7003's `isIosNativeShellPath` fix, in the same
file, missed when that fix landed because it targeted the one function named
in that finding rather than sweeping every matcher in the module for the
identical shape.

### Evidence

RED→GREEN proven with `git stash` on `src/lib/ios-tool-routes.ts` alone
(test file kept):

```
# before fix (git stash push -- src/lib/ios-tool-routes.ts)
# tests 15 / pass 14 / fail 1
not ok — strips a query string or hash before matching the exact-match /dashboard branch
  AssertionError [ERR_ASSERTION]:
    getIosRouteKey("/dashboard?ref=upgrade")        → "other", expected "dashboard"
    getIosRouteKey("/dashboard#widgets")             → "other", expected "dashboard"
    getIosRouteKey("/dashboard/positions?tab=open")  → "dashboard" (this one already passed —
      the trailing-slash branch's startsWith("/dashboard/") still matches before the "?" is hit)

# after fix (git stash pop)
# tests 15 / pass 15 / fail 0
```

New test added (`getIosRouteKey` describe block):

```ts
it("strips a query string or hash before matching the exact-match /dashboard branch", () => {
  assert.equal(getIosRouteKey("/dashboard?ref=upgrade"), "dashboard");
  assert.equal(getIosRouteKey("/dashboard#widgets"), "dashboard");
  assert.equal(getIosRouteKey("/dashboard/positions?tab=open"), "dashboard");
});
```

### Blast radius

`getIosRouteKey` has two real call sites repo-wide:
`src/components/ios/IosAppChrome.tsx` (sets the `data-ios-route` attribute
used by CSS/chrome) and `src/components/ios/IosLargoFab.tsx` (keys the Largo
FAB's per-route behavior). Both feed it `path` from `usePathname()` via
`next/navigation`, which by contract never includes a query string or hash —
so, exactly like the sibling #7003 fix, this bug is **confirmed unreachable
in the current codebase** via these two call sites. No other consumer was
found (`git grep -n "getIosRouteKey"` across `*.ts`/`*.tsx`). Fixed anyway so
the function is correct standing alone and consistent with every other
matcher in this file — three of which (`isIosToolRoute`, `getIosToolMeta`,
`getIosToolRouteIndex`) already normalize, and a fourth (`isIosNativeShellPath`)
was fixed to do the same in the immediately preceding commit on this exact
file — rather than leaving the one remaining asymmetric matcher as a latent
defect for the next caller that doesn't come from `usePathname()` (a
server-side check against a raw request URL, a deep-link handler, a
native-bridge entry point passing `window.location.pathname + search`).

### Fix rationale

Same fix as #7003, applied to the one remaining unnormalized matcher: route
the function's input through the already-shared `normalizeIosPath` helper
before any branch runs, rather than normalizing per-branch or inventing a
second helper. This is the smallest change that removes the asymmetry,
matches every other matcher in the module, and needs no change to either
call site (`IosAppChrome.tsx`, `IosLargoFab.tsx`) or to `getIosHeaderMeta`,
which already computes and discards its own separate `path.split(/[?#]/)[0]`
before delegating to `getIosToolMeta`/`getIosRouteKey` — those two callees
now normalize internally regardless, so `getIosHeaderMeta`'s own inline strip
stays redundant-but-harmless and was left untouched to keep this PR scoped to
the one real defect.
