> **kind:** FINDING

## Vector `/vector` desk: ticker-select had no stale-fetch guard — fast re-selection could show the wrong ticker's chart data

| **Status** | Fixed |
|---|---|

### Root cause

`VectorPageClient.tsx`'s `onTickerSelect` (the handler behind `navigateTicker`, wired to the
ticker dropdown, the universe scanner (`VectorScanner`), and the cross-ticker comparison strip
(`VectorTickerComparisonStrip`) on `/vector`) fetched the next ticker's client seed and applied it
with **no protection against out-of-order resolution**:

```ts
const onTickerSelect = useCallback(
  async (next: string) => {
    if (!seed || next === seed.ticker) return;
    setNavBusy(true);
    const path = next === VECTOR_DEFAULT_TICKER ? "/vector" : `/vector?ticker=${encodeURIComponent(next)}`;
    router.replace(path, { scroll: false });
    try {
      const clientSeed = await fetchVectorClientSeed(next);
      setSeed(clientSeed);
    } finally {
      setNavBusy(false);
    }
  },
  [router, seed]
);
```

The only guard was `next === seed.ticker`, comparing against the component's current `seed`
state. If a member clicked ticker **A** in the scanner/comparison strip, then clicked ticker **B**
before A's `fetchVectorClientSeed` resolved, the SECOND call's closure also read the same
still-stale `seed` (A's fetch hadn't resolved yet, so `seed.ticker` was still whatever ticker was
active before either click) — so neither call blocked the other, and both fetches ran
concurrently. Whichever network response settled LAST won the `setSeed()` call, regardless of
click order. If A's (slower) response arrived after B's (faster) one, the desk ended up showing
ticker B's URL and header (`router.replace` already pointed at B) with ticker A's chart/walls/bars
underneath — a real, member-visible data-ticker mismatch, not just a cosmetic flicker.

None of the UI entry points that call `navigateTicker` (`VectorScanner`'s row `onClick`,
`VectorTickerComparisonStrip`'s chip `onClick`) disable themselves while `tickerNavBusy` is true,
so rapid re-selection — scanning several names quickly, or a misclick followed by a correction —
is an ordinary, expected interaction, not an edge case.

This is the exact "stale-fetch-race-without-generation-guard" shape already fixed ten times this
sweep in sibling files (`ContractDrilldownDrawer.tsx` round 231, `TickerDrawer.tsx` "Bug 13",
`FlowFeed.tsx`, `AdminApiLiveFeed.tsx`, `HomeGammaPromo.tsx`, `GexHeatmap.tsx`, etc.) — this
particular call site had never been touched.

### Evidence

Added `src/features/vector/lib/vector-ticker-select-guard.ts`, exporting the extracted guard
function `runTickerSelectGuardedLoad`, and a direct unit test
(`vector-ticker-select-guard.test.ts`) that reproduces the race with two deferred promises
resolving out of order (older "ticker A" request resolves AFTER newer "ticker B" request):

- **RED** (pre-fix shape — no generation check, mirrors the original `onTickerSelect` body
  exactly): the test asserted the final applied seed is `{ ticker: "B" }` (the member's actual last
  selection); the unguarded version applied `{ ticker: "A" }` instead —
  `AssertionError: expected { ticker: 'B' }, got { ticker: 'A' }`.
- **GREEN** (post-fix, with the generation check): same test passes — the stale A response is
  discarded, B's seed stays applied, and `onSettle` (which clears `navBusy`) fires exactly once
  (for B), never a second time for the abandoned A request.

`npx tsc --noEmit` clean. Full `src/features/vector/lib/*.test.ts` suite (1328 tests) green.

### Blast radius

Only `VectorPageClient.tsx`'s `onTickerSelect` called the unguarded fetch-then-`setSeed` pattern
for ticker switching on `/vector`. No other call site in the repo fetches a Vector client seed and
applies it directly without a generation/cancellation guard — `use-vector-contract-picks.ts`,
`use-vector-pick-live-monitor.ts`, `use-vector-helix-flows.ts`, and `TickerDrawer.tsx` were all
checked this round and already carry their own `genRef`/`cancelled` guards (several from prior
rounds' fixes for this exact vein). The bootstrap effect at the top of `VectorPageClient.tsx`
(triggered by the `bootstrapTicker` URL prop on full navigation) already had its own `cancelled`
flag and was not affected.

### Fix rationale

Extracted the generation-guard into a small, pure, directly-testable function
(`runTickerSelectGuardedLoad`), matching the established pattern (`ContractDrilldownDrawer.tsx`'s
`runGenerationGuardedLoad`) rather than inlining a new ad-hoc guard — this repo has no React
rendering test harness, so pulling the race-closing logic out into a plain async function (no
JSX, no hooks) is what makes it unit-testable at all. Put it in its own `.ts` lib file
(`vector-ticker-select-guard.ts`) rather than inside `VectorPageClient.tsx` itself: importing the
`.tsx` component file directly in a test transitively pulls in the full Vector desk component
tree (`VectorPageShell`, `PhosphorBoot`, `ProductMark`/`geometry.tsx`, …), and at least one of
those (`geometry.tsx`, JSX with no explicit `React` import) fails to load under this repo's bare
`tsx --test` runner (`ReferenceError: React is not defined`) outside of a real bundler — unrelated
to this fix, but it meant the guard had to live somewhere that doesn't drag that chain in to be
testable at all.

`onTickerSelect`'s own generation ref (`tickerSelectGenRef`, bumped once per real ticker-switch
call, before `router.replace`) is checked both at success (via the guard's own `generation !==
currentGeneration()` check before calling `setSeed`) and at settle (`navBusy` only clears for the
latest call) — so an abandoned ticker switch neither overwrites a newer one's chart data nor
flips `navBusy` back off a second time after it was already cleared by the newer call. No fetch
behavior, caching, or the bootstrap-effect's own existing `cancelled` guard was touched.
