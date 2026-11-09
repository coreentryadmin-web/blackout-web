> **kind:** FINDING

## Vector desk's own `/vector` page could blank an already-rendering chart on a transient phase-2 fetch hiccup — FIXED

| | |
|---|---|
| **Area** | Vector desk — `src/features/vector/components/VectorPageClient.tsx` (two-phase chart seed bootstrap); new pure guard added as `src/features/vector/lib/vector-seed-upgrade-guard.ts` |
| **Severity** | P3 — correctness/display regression (not a trading-decision bug): a healthy, already-rendering `/vector` desk chart could visibly regress to empty on a transient, fully-recoverable fetch failure |
| **Status** | FIXED |

### Root cause

`VectorPageClient` (the `/vector` page's client bootstrap) loads the main desk chart in the same
two-phase sequence `SpxVectorEmbed.tsx` uses: phase 1 (`fetchVectorEmbedFastSeed`) fetches bars +
walls + the decimated rail-bootstrap and renders immediately via `setSeed(fastToClientSeed(...))`;
phase 2 (`fetchVectorClientSeed`) then fetches the fuller, gap-filled wall history and is supposed
to *upgrade* the display once it lands.

Before this fix, the bootstrap effect called `setSeed(full)` **unconditionally** once phase 2
resolved:

```ts
const fast = await fetchVectorEmbedFastSeed(bootstrapTicker);
if (cancelled) return;
setSeed(fastToClientSeed(bootstrapTicker, fast));
const full = await fetchVectorClientSeed(bootstrapTicker);
if (cancelled) return;
setSeed(full);
```

`fetchVectorClientSeed` (`vector-client-seed.ts`) never rejects — every one of its internal
fetches goes through a shared `fetchJson` helper that swallows a network/parse failure and
resolves `null` rather than throwing:

```ts
async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
```

So a transient failure on *just* the phase-2 bars fetch (a 500, a timeout, an ALB blip — nothing
wrong with phase 1, which already succeeded and is on screen) makes `fetchVectorClientSeed`
resolve with `initialBars: []` (the `barsPayload?.bars ?? []` null-coalesce), not reject. The
page's unconditional `setSeed(full)` then replaced a chart that was already correctly showing
real bars with an empty one — a visible regression on a fetch that has nothing to do with the
data already on screen, and one a member has no way to distinguish from "this ticker genuinely
has no bars right now" (which never happens once a session exists).

This is the same defect, independently present, as the one just fixed in `SpxVectorEmbed.tsx`
(PR #7748, `shouldAdoptFullVectorSeed`) — that PR's own write-up claimed the regression was
unique to the SPX Slayer embed ("every other `fetchVectorClientSeed` caller is a one-shot
ticker-switch load with no earlier 'fast' seed to regress from"), but `VectorPageClient.tsx` runs
the identical fast-seed-then-full-seed-upgrade sequence on the same `setSeed` state for the main
`/vector` desk page itself, so it carries the exact same bug independently of that PR.

### Evidence

Confirmed RED→GREEN on the extracted pure decision helper (`shouldAdoptFullVectorPageSeed`,
`src/features/vector/lib/vector-seed-upgrade-guard.ts`):

- **Before the fix** (component called `setSeed(full)` unconditionally — equivalent to a guard
  whose body always returns `true`): the regression test
  `shouldAdoptFullVectorPageSeed rejects a degraded (empty-bars) full seed when the fast seed
  already had real bars` fails — `assert.equal(shouldAdoptFullVectorPageSeed(390, 0), false)`
  gets `true` (confirmed locally by temporarily hardcoding the guard's body to `return true;` and
  re-running — 1 failure, exactly this test).
- **After the fix**: that test and its two siblings (adopt when the full seed genuinely has bars;
  adopt an empty full seed when the fast seed was also empty) all pass — 3/3 in
  `vector-seed-upgrade-guard.test.ts`, 6/6 alongside the pre-existing
  `vector-client-seed.test.ts` suite in the same directory. `npx tsc --noEmit` clean.

### Blast radius

Single call site: `VectorPageClient.tsx`'s bootstrap `useEffect` is the only place in this file
that runs the fast→full sequence on `setSeed`; the separate `onTickerSelect` path (a one-shot
ticker-switch load via `runTickerSelectGuardedLoad`) and the compare-mode seeding path have no
earlier "fast" seed on the same state to regress from, so they are unaffected and left untouched.
No other file imports `fetchVectorClientSeed` in this same two-phase shape apart from
`SpxVectorEmbed.tsx` (already fixed in PR #7748) and this one.

### Fix rationale

Same fix shape as `SpxVectorEmbed.tsx`'s `shouldAdoptFullVectorSeed`: extract the adoption
decision into a small, pure, independently-testable function rather than inlining an `if` in the
component. Kept as its own new module (`vector-seed-upgrade-guard.ts`) rather than folded into
`vector-client-seed.ts` — PR #7748 (open, not yet merged at the time of this fix) already adds a
same-shaped helper to that file for its own call site, and touching the same file for an unrelated
call site would create an avoidable merge-ordering dependency between two independent PRs (see
this repo's own "CROSS-PR ORDERING DEPENDENCIES" guidance). The rule is identical: adopt the full
seed when it actually carries bars, OR when the fast seed never had any bars to begin with (both
legitimately empty — e.g. a genuinely pre-open session — is not a regression, and still lets the
full seed's other fields such as wall history refresh).

Deliberately left unchanged: the two-phase fast→full load shape itself (the documented,
intentional pattern for Vector desk bootstraps), the outer `catch` fallback (unreachable in
practice today since neither `fetchVectorEmbedFastSeed` nor `fetchVectorClientSeed` ever reject,
but left as a defensive last resort rather than removed), and every other field
(walls/history/gammaFlip) still upgrading together with bars rather than being gated
field-by-field, matching the same "whole-upgrade" granularity as the sibling fix.

### Regression tests added

`src/features/vector/lib/vector-seed-upgrade-guard.test.ts`:
- `shouldAdoptFullVectorPageSeed rejects a degraded (empty-bars) full seed when the fast seed
  already had real bars`
- `shouldAdoptFullVectorPageSeed adopts a full seed that genuinely carries bars`
- `shouldAdoptFullVectorPageSeed adopts an empty full seed when the fast seed was ALSO empty`
