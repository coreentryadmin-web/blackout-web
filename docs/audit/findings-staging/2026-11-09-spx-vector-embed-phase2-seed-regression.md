> **kind:** FINDING

## SPX Slayer's embedded Vector chart could blank a rendering chart on a transient phase-2 fetch hiccup — FIXED

| | |
|---|---|
| **Area** | SPX desk — `src/features/spx/components/SpxVectorEmbed.tsx` (two-phase chart seed load), fix helper added to `src/features/vector/lib/vector-client-seed.ts` |
| **Severity** | P3 — correctness/display regression (not a trading-decision bug): a healthy, already-rendering chart could visibly regress to empty on a transient, fully-recoverable fetch failure |
| **Status** | FIXED |

### Root cause

`SpxVectorEmbed` loads the embedded Vector chart in two phases to keep SPX Slayer's TTFB low:
phase 1 (`fetchVectorEmbedFastSeed`) fetches bars + walls + the decimated rail-bootstrap in
parallel and renders immediately; phase 2 (`fetchVectorClientSeed`) then fetches the fuller,
gap-filled wall history and is supposed to *upgrade* the display once it lands.

The component called `setSeed(full)` **unconditionally** after phase 2 resolved:

```ts
const full = await fetchVectorClientSeed("SPX");
if (cancelled) return;
setSeed({
  bars: full.initialBars,
  ...
});
```

The bug is that `fetchVectorClientSeed` can resolve *successfully* with an effectively empty
payload. Its own `fetchJson` helper swallows every network/parse failure and returns `null`
rather than throwing:

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

so a transient failure on *just* the phase-2 bars fetch (a 500, a timeout, an ALB blip — nothing
wrong with phase 1, which already succeeded and is on screen) makes `fetchVectorClientSeed`
resolve with `initialBars: []` (the `barsPayload?.bars ?? []` null-coalesce), not reject. The
component's unconditional `setSeed(full)` then replaced a chart that was already correctly
showing real RTH candles with an empty one — a visible regression caused by a fetch that has
nothing to do with the data already on screen, and one the member has no way to distinguish from
"SPX genuinely has no bars right now" (which never happens once a session exists).

### Evidence

Confirmed RED→GREEN on the extracted pure decision helper (`shouldAdoptFullVectorSeed`,
`src/features/vector/lib/vector-client-seed.ts`):

- **Before the fix** (component called `setSeed(full)` unconditionally — equivalent to a
  guard that always returns `true`): the new regression test
  `shouldAdoptFullVectorSeed rejects a degraded (empty-bars) full seed when the fast seed
  already had real bars` fails — `assert.equal(shouldAdoptFullVectorSeed(390, 0), false)`
  gets `true`.
- **After the fix**: that test and two siblings (adopt when the full seed genuinely has bars;
  adopt an empty full seed when the fast seed was also empty) all pass — 6/6 in
  `vector-client-seed.test.ts`.

Reproduced the exact RED state locally by temporarily hardcoding the guard's body to `return
true;` (simulating the pre-fix unconditional adopt) and re-running the suite: 1 failure, exactly
the new test above. Restored the fix: 6/6 green. `npx tsc --noEmit` clean.

### Blast radius

Single call site: `SpxVectorEmbed` is the only consumer of `fetchVectorClientSeed` /
`fetchVectorEmbedFastSeed` that runs them as this two-phase fast→full sequence on the same
`setSeed` state (grepped — every other `fetchVectorClientSeed` caller is a one-shot ticker-switch
load with no earlier "fast" seed to regress from, so this specific race is unique to the SPX
Slayer embed). The fix is scoped to that one component plus the shared pure helper it now calls.

### Fix rationale

Extract the adoption decision into a pure, testable function (`shouldAdoptFullVectorSeed`) rather
than inlining an `if` in the component, matching this file's existing pattern (every other
exported function here is already a plain, side-effect-free seed builder with its own test file).
The rule: adopt the full seed when it actually carries bars, OR when the fast seed never had any
bars to begin with (both legitimately empty — e.g. a genuinely pre-open session — is not a
regression, and still lets the full seed's other fields such as wall history refresh). This is
the same "a failed refresh must not wipe a good prior read" discipline already shipped elsewhere
in this exact file's neighborhood (`vector-dark-pool-cache.ts`'s `warmVectorDarkPool`: "a
transient UW outage must not actively WIPE good levels a previous run fetched — skip the write").

Deliberately left unchanged: the two-phase fast→full load shape itself (it's the documented,
intentional TTFB optimization), and every other field (walls/history/gammaFlip) still upgrades
together with bars rather than being gated field-by-field — a partial phase-2 success that
nonetheless returns zero bars is itself evidence the whole phase-2 fetch round degraded, so
holding the whole upgrade back (not just the bars field) is the simpler and safer rule.

### Regression tests added

`src/features/vector/lib/vector-client-seed.test.ts`:
- `shouldAdoptFullVectorSeed rejects a degraded (empty-bars) full seed when the fast seed already
  had real bars`
- `shouldAdoptFullVectorSeed adopts a full seed that genuinely carries bars`
- `shouldAdoptFullVectorSeed adopts an empty full seed when the fast seed was ALSO empty`
