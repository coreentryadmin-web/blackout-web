> **kind:** FINDING

## `getIosTabRailIndex` (src/lib/ios-tab-rail.ts) — dead export, zero production callers — FIXED

**Status:** FIXED (removed, round 177 DISCOVERY sweep)

### Root cause

`getIosTabRailIndex(path)` was added in the same commit that introduced the whole
`src/lib/ios-tab-rail.ts` module (#1417, "iOS phase-2 polish: 5-tab Intel hub rail, Largo FAB,
..."). Its own test describes it as resolving the active tab's array index "for transitions" —
clearly written in anticipation of a manual index-driven tab-switch animation (the kind of thing
you'd use to compute slide direction/offset between tab N and tab N+1).

That never happened. The one production consumer of this module, `IosAppTabBar.tsx`, renders the
active-tab indicator with framer-motion's shared-layout animation instead
(`motion.span layoutId="ios-native-tab-indicator"` / `"ios-native-tab-underline"`) — framer-motion
computes the slide transform itself from the DOM positions of the previous/next elements sharing
that `layoutId`, with no numeric index needed anywhere in the component. `isIosTabRailActive` (a
boolean per-tab check) is all the tab bar actually reads.

So `getIosTabRailIndex` was never wired into the component it was built for an index-based version
of, and nothing else in the app has any reason to ask "what index is this path's tab" — every other
consumer of tab-rail state (`IosAppTabBar.tsx`, `IosIntelligenceHubSegment.tsx`) works off the
route string or the boolean `isIosTabRailActive`/`isIosIntelligenceHubPath` directly.

### Evidence

Repo-wide grep (every file type, `.git` and `node_modules` excluded) before removal:

```
$ grep -rn "getIosTabRailIndex" . --include="*.*" | grep -v node_modules | grep -v '\.git/'
./src/lib/ios-tab-rail.ts:70:export function getIosTabRailIndex(path: string): number {
./src/lib/ios-tab-rail.test.ts:5:  getIosTabRailIndex,
./src/lib/ios-tab-rail.test.ts:28-32:  (five assertions calling it)
```

Every hit is either the definition itself or its own unit test — no production file (component,
hook, route) ever imports it. `src/lib/ios-tab-rail.ts` has exactly one commit in its history
(`e39eea06f`, #1417) — the function was dead from the moment it was introduced, not orphaned by a
later refactor.

`git log --all -S"getIosTabRailIndex"` returns only that same introducing commit (plus its
duplicate merge-commit hash) — the symbol was never referenced from any other commit in the
project's history, confirming this isn't a recently-orphaned call site either.

Cross-checked it isn't a "missing wiring" case (the other shape this lane has found before, e.g.
`VECTOR_VIEW_STORAGE_KEY`): `IosAppTabBar.tsx`'s active-tab transition is fully implemented via
framer-motion `layoutId`, which is a complete, shipped feature that simply doesn't need this helper
— not a half-wired feature missing its last step.

### Blast radius

One file (`src/lib/ios-tab-rail.ts`) defines it; one file (`src/lib/ios-tab-rail.test.ts`) tests it.
No other call site exists, so removal has zero behavioral effect on any shipped surface. `IOS_TAB_RAIL`,
`isIosIntelligenceHubPath`, and `isIosTabRailActive` (the three symbols the real consumers use) are
untouched.

### Fix rationale

Removed `getIosTabRailIndex` from `src/lib/ios-tab-rail.ts` and its corresponding test block from
`src/lib/ios-tab-rail.test.ts` (the "resolves tab index for transitions" `it()`), per this repo's
existing dead-export-removal convention (e.g. #5845, #5830, #5916, #5812 and others in the same
vein: grep+history-verify, remove, confirm `tsc`/tests clean — no RED→GREEN cycle applies since
there is no reachable behavior to regress). Left `IOS_TAB_RAIL`/`isIosIntelligenceHubPath`/
`isIosTabRailActive` untouched — all three are live, each with a real consumer confirmed above.

Verification: `npx tsc --noEmit` clean; `src/lib/ios-tab-rail.test.ts` and the rest of the iOS-named
test files (69 tests, 7 suites) pass after the removal.
