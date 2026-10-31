> **kind:** FINDING

## `IosNativeSegment`'s Framer Motion indicator used one hardcoded `layoutId` shared by every instance — two simultaneously-mounted segmented controls collide — FIXED

| | |
|---|---|
| **Area** | Shared native-iOS component, `src/components/ios/IosNativeSegment.tsx` — reused by Helix (`FlowFeed`), the Intelligence Hub (`IosIntelligenceHubSegment`), SPX, Vector, and Night Hawk |
| **Status** | FIXED |
| **Severity** | P3 (live UI defect, native iOS shell only — a visible segmented-control loses its active-tab highlight; no data-correctness or financial impact) |

### Root cause

`IosNativeSegment` renders the sliding active-tab highlight as a `<motion.span layoutId="ios-native-segment-indicator">` — a literal string constant, identical across **every** instance of the component anywhere on the page. Framer Motion's shared-layout animation requires `layoutId` to be unique among elements mounted **at the same time**: when two elements carry the same id, Framer Motion treats them as one logical element being relocated, and only the most-recently-mounted copy keeps a visible indicator — the other instance's active tab silently loses its highlight (or the pill visibly "teleports" between the two unrelated controls on the next value change).

This is not a hypothetical double-mount. `HelixPageShell` (`src/features/helix/components/HelixPageShell.tsx`) renders, unconditionally and simultaneously, on the native iOS `/flows` page:

- `<IosIntelligenceHubSegment />` (line 71) — gated only on `nativeShell`, and `isIosIntelligenceHubPath("/flows")` is true, so it renders its own `IosNativeSegment` (Flow / Thermal switcher) with an active tab.
- `<FlowFeed />` (line 73), which itself renders (`FlowFeed.tsx` line 1111) `{nativeShell && <IosNativeSegment ... />}` — the HELIX "Live tape / Analytics" lens switcher, also with an active tab.

Both conditions (`nativeShell` true, path `/flows`) are satisfied together on exactly the page a native-iOS member actually lands on when opening HELIX, so both `IosNativeSegment` instances mount at once, each contributing its own active `<motion.span layoutId="ios-native-segment-indicator">` to the tree.

### Evidence

Confirmed via a regression test that mocks Framer Motion's `motion.span` with a plain element threading `layoutId` through as an inspectable `data-layout-id` attribute (Framer Motion's real runtime doesn't serialize `layoutId` to static HTML, so `renderToStaticMarkup` alone can't surface the collision — the mock makes the exact id Framer Motion would receive observable).

Rendering two `IosNativeSegment` instances together, each with an active tab, on origin/main (`ca0c2bf5`):

```
layoutIds = ["ios-native-segment-indicator", "ios-native-segment-indicator"]
// identical — Framer Motion sees ONE logical element, not two
```

`node --experimental-test-module-mocks --test` on the unmodified source: **RED**, `AssertionError [ERR_ASSERTION]: ... expected: 'ios-native-segment-indicator' actual: 'ios-native-segment-indicator'` (`notEqual` failing because both are the same literal). Restoring the fix: **GREEN**, 2/2 passing. Proven via `git stash` on `src/components/ios/IosNativeSegment.tsx` alone (test file kept) — stash → RED, pop → GREEN.

### Blast radius

Every current call site reuses the one `IosNativeSegment` definition, so the fix at the shared component fixes all of them at once rather than needing five separate patches:

- `src/features/helix/components/FlowFeed.tsx` (Live tape / Analytics)
- `src/components/ios/IosIntelligenceHubSegment.tsx` (Flow / Thermal) — mounted alongside the one above on `/flows`
- `src/features/spx/components/SpxDashboard.tsx` (two call sites, Vector/Matrix/Intel — mutually exclusive on `nativeShell` so not independently double-mounted today, but each still shared the same literal id and would have collided with any sibling instance, including the Helix one if ever composed together)
- `src/features/vector/components/VectorPageShell.tsx`
- `src/features/nighthawk/components/NightHawkFeed.tsx`

No other file currently double-mounts two instances the way `HelixPageShell` does, but the bug was in the *shared component's contract*, not in one caller — any future page that composes two of these controls (a very normal thing to want on a dashboard) would silently hit the same collision again, which is why the fix belongs in `IosNativeSegment.tsx` itself rather than as a one-off prop threaded through only the Helix call sites.

### Fix rationale

Replaced the hardcoded literal with `` `ios-native-segment-indicator-${useId()}` ``, where `useId()` (React) returns a value stable for the component's lifetime and unique per mounted instance. This keeps the existing shared-layout slide animation working **within** one segmented control (the indicator still smoothly moves between tabs as `value` changes, because the id is stable across re-renders of the same instance) while making it impossible for two separate instances to collide, regardless of which two pages/components happen to compose them.

Considered and rejected: threading an explicit `id`/`layoutId` prop down from every call site. That would fix today's five call sites but reintroduce the exact same class of bug the moment a sixth call site forgets to pass a unique value — the whole point of a shared component is that callers shouldn't have to know about its internal animation plumbing. `useId()` makes the uniqueness the component's own responsibility, which is where it belongs.

### Files changed

- `src/components/ios/IosNativeSegment.tsx` — per-instance `layoutId` via `useId()`.
- `src/components/ios/IosNativeSegment.test.tsx` — new regression test (mocks `framer-motion`, renders two instances, asserts distinct `layoutId`s; also asserts a single instance still gets exactly one indicator).
