> **kind:** FINDING

## HELIX ContractDrilldownDrawer: stale contract fetch could overwrite the currently-viewed contract's data — FIXED

**Status:** FIXED (PR pending merge, branch `fix/round231-sweep`)

### Root cause

`ContractDrilldownDrawer.tsx`'s `load()`/`loadHistory()` fetched `GET /api/market/option-contract`
and `GET /api/market/option-contract-history` keyed off whichever `flow` (the clicked print) was
passed in, with no protection against out-of-order resolution. The drawer's `useEffect` re-ran
`load(flow)`/`loadHistory(flow)` on every `flow` change with no cancellation of the previous
in-flight call:

```tsx
useEffect(() => {
  if (flow) {
    void load(flow);
    void loadHistory(flow);
  } else { ... }
}, [flow, load, loadHistory]);
```

If a member clicked print A, then clicked a different print B before A's fetch resolved, BOTH
fetches ran concurrently. Network timing — not click order — decided which one's `setData`/
`setHistory` landed last. If A's response arrived after B's, the unconditional `setData(d)` in the
old `load()` overwrote B's already-correct contract data with A's, while the drawer's header
(`<Drawer>`'s `title`, driven straight off the `flow` prop rather than the fetch) continued to
correctly show B's ticker/strike/expiry. The member would see the right header over the wrong
contract's open interest, intraday volume/price chart, per-fill table, and multi-day history.

This is the exact bug shape the sibling `TickerDrawer.tsx` already guards against with its own
`loadGenerationRef` (labeled "Bug 13" in that file's own comments) — `ContractDrilldownDrawer.tsx`
never got the same treatment when it was added.

### Evidence

Added `src/features/helix/components/ContractDrilldownDrawer.test.ts`, which drives the newly
extracted `runGenerationGuardedLoad` helper directly: two fake requests (older generation 1, newer
generation 2) are made to resolve in **reverse** order (1 settling after 2), which is exactly the
ordering that exposed the bug.

- **RED (pre-fix):** reverting the fix (`git stash`) makes the test file fail to even load —
  `runGenerationGuardedLoad` doesn't exist yet, so all 3 new tests fail with `ERR_TEST_FAILURE`.
- **GREEN (post-fix):** all 3 new tests pass; the stale (generation-1) result never overwrites the
  current (generation-2) state, and the stale request's `onSettle`/error paths are also correctly
  suppressed.
- Full `src/features/helix/components/*.test.{ts,tsx}` suite: 56/56 pass.
- `tsc --noEmit`: clean.

### Blast radius

Single file (`ContractDrilldownDrawer.tsx`) — the only other consumer of
`fetchOptionContractDrilldown`/`fetchOptionContractHistory` is this same drawer. `TickerDrawer.tsx`
already has its own, independent generation guard and was not touched.

### Fix rationale

Extracted a small, pure, exported async helper (`runGenerationGuardedLoad`) used by both `load()`
and `loadHistory()`, rather than duplicating TickerDrawer's inline `if (generation !==
loadGenerationRef.current) return;` checks in two more places. This also makes the guard
independently unit-testable without needing React rendering/jsdom (neither of which this repo's
test runner sets up for component files) — the test exercises the real exported function with fake
deferred promises, not a reimplementation. `loadGenerationRef` is bumped once per `flow` change
(including when `flow` becomes `null`, so a closed-then-reopened drawer can't be confused with its
own prior session either). Left `AbortController`/fetch cancellation out of scope: the guard already
makes a stale response harmless, and `fetchOptionContractDrilldown`/`fetchOptionContractHistory`
(`src/lib/api.ts`) don't currently accept a signal — wiring that through would be a larger,
separate change for a wasted-request optimization, not a correctness fix.
