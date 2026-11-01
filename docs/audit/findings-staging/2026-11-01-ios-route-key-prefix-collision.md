> **kind:** FINDING

## `getIosRouteKey` misclassifies sibling routes that merely share a tool's URL prefix — FIXED

**File:** `src/lib/ios-tool-routes.ts`

### Root cause

`getIosRouteKey(path)` maps a URL path to the `IosRouteKey` used for the native iOS shell's
`data-ios-route` attribute, header metadata, and the contextual "Ask Largo" link
(`IosLargoFab.tsx`). Every branch except `/dashboard` matched with a bare
`p.startsWith(prefix)` — no requirement that the prefix be followed by `/` or end the string.
The function's own comment even framed this as deliberate ("every other branch here is a bare
startsWith, which already tolerates a suffix appended directly after the prefix"), while its own
`/dashboard` branch, and every sibling matcher in the SAME FILE
(`isIosToolRoute`, `getIosToolRouteIndex`, `getIosToolMeta`, `isIosNativeShellPath`), all require
an exact match or a `/`-bounded prefix (`p === prefix || p.startsWith(prefix + "/")`).

That inconsistency is live-reachable: two real, top-level routes already exist in this app that
share a prefix with a tool route without a `/` boundary —

- `src/app/nighthawk-boards-preview/page.tsx` → `/nighthawk-boards-preview`
- `src/app/vector-board-preview/page.tsx` → `/vector-board-preview`

Both are public marketing preview pages, siblings of (not sub-routes of) `/nighthawk` and
`/vector`. `getIosRouteKey("/nighthawk-boards-preview")` returned `"nighthawk"` and
`getIosRouteKey("/vector-board-preview")` returned `"vector"` — both wrong; a marketing preview
page is not the Night Hawk or Vector tool, and should resolve to `"other"` like every other
non-tool, non-utility path.

### Evidence

Reproduced directly against the unmodified function:

```
getIosRouteKey("/nighthawk-boards-preview") -> "nighthawk"   (expected "other")
getIosRouteKey("/vector-board-preview")     -> "vector"      (expected "other")
```

Added a regression test (`src/lib/ios-tool-routes.test.ts`, `getIosRouteKey` describe block,
"does not misclassify a sibling route that merely shares a tool's prefix") that fails on the
pre-fix code (`actual: 'nighthawk'`, `expected: 'other'`) and passes after the fix. Confirmed via
`git stash` (RED on the unmodified source, GREEN after re-applying the fix):

```
# before fix
not ok 3 - does not misclassify a sibling route that merely shares a tool's prefix
  expected: 'other'
  actual: 'nighthawk'

# after fix
# pass 17
# fail 0
```

Full existing suite (`src/lib/ios-tool-routes.test.ts`) and `tsc --noEmit` both stay green.

### Blast radius

`getIosRouteKey` has three call sites, all gated by `isIosNativeShellRoute(path)` (which itself
already uses the correct `/`-bounded match) before the chrome renders at all:

- `IosAppChrome.tsx` — sets `document.documentElement.setAttribute("data-ios-route", ...)`, which
  drives `[data-ios-route="..."]` CSS selectors for native-shell styling.
- `IosLargoFab.tsx` — picks the `?context=` query param for the contextual "Ask Largo" deep link.
- `getIosHeaderMeta` (same file) — title/kicker/accent for the native header, and the `showBack`
  affordance.

Because every current call path happens to pre-filter through `isIosNativeShellRoute`/
`isIosToolRoute` (both already correct), the two preview routes never actually reach native-shell
chrome in production today — so this specific defect has not yet produced a visible, member-
facing symptom. It is fixed anyway because: (1) `getIosRouteKey` is an exported, documented,
general-purpose "map a URL path to a route key" function with its own test suite — its behavior
should be correct standing alone, independent of what today's callers happen to additionally
gate, exactly the standard this file's own `isIosNativeShellPath` fix (same file, same comment
pattern) was already held to; (2) it is one `if` away from becoming reachable (e.g. a future
caller using `getIosRouteKey` directly, or a future preview/demo page added under any of the other
ten colliding prefixes — `/flows`, `/heatmap`, `/terminal`, `/meridian`, `/account`, `/faq`,
`/learn`, `/upgrade`, `/admin` all had the identical bare-`startsWith` exposure, just without a
same-shaped sibling route existing yet to prove it); and (3) the fix is a pure, low-risk
consistency clean-up that makes every branch in the function follow the same rule its own
"/dashboard" branch and every sibling matcher in the file already use.

### Fix rationale

Replaced the per-branch bare `p.startsWith(prefix)` checks with a single `matches(prefix)` helper
(`p === prefix || p.startsWith(prefix + "/")`), applied uniformly to all twelve branches —
identical semantics to `isIosToolRoute`/`getIosToolRouteIndex`/`getIosToolMeta`/
`isIosNativeShellPath` in the same file. This is the minimal change: no branch order, return
value, or the `/dashboard` branch's existing (already-correct) behavior changes — only the
matching rule for the other eleven branches is tightened to match the one branch (and every
sibling function) that was already correct. Verified this doesn't regress any real nested route
(`/nighthawk/edition`, `/vector?ticker=SPY`, `/learn/spx-slayer`, `/admin/health`, etc.) via the
existing and new test assertions.
