> **kind:** FINDING

## HomeGammaPromo's gamma-snapshot fetch had no guard against a stale ticker response overwriting a newer one — FIXED

| | |
|---|---|
| **Area** | Public homepage · `HomeGammaPromo` (free gamma-snapshot promo panel) |
| **Severity** | P3 (visible data-integrity defect on the public homepage, no auth/member impact) |
| **Status** | Fixed |

### Root cause

`HomeGammaPromo.tsx` (`src/components/landing/HomeGammaPromo.tsx`) renders a public, no-login
gamma-levels preview (SPX/SPY/QQQ spot, call wall, put wall, gamma flip) fed by
`GET /api/public/gex-snapshot?ticker=...`. Its `loadTicker(next)` function is invoked from TWO
independent triggers that can both be in flight at the same time:

1. A 5s visibility-gated background poll (`useEffect`'s `tick()`, closed over whichever `ticker`
   was selected when that effect last ran).
2. A manual ticker-pill click (`selectTicker`), which flips `ticker` state and immediately calls
   `loadTicker` for the newly-selected ticker.

The old code applied whichever response arrived LAST, unconditionally:

```tsx
const loadTicker = useCallback(async (next: PublicGexTicker) => {
  setLoading(true);
  try {
    const res = await fetch(`/api/public/gex-snapshot?ticker=${next}`, { cache: "no-store" });
    if (res.ok) setSnapshot(await res.json());
  } catch { /* keep last good read */ }
  finally { setLoading(false); }
}, []);
```

Nothing tracked which ticker's request was issued LAST. Sequence that reproduces the bug: a
background poll tick for SPX starts (in flight), the member clicks the QQQ pill before it
resolves (starts a second, concurrent fetch for QQQ), and — purely by network timing, not click
order — the SPX poll's response arrives AFTER the QQQ click's. The old code then painted SPX's
spot/call-wall/put-wall/flip numbers onto the panel while the "QQQ" tab stayed visibly selected
(`aria-selected`/`is-active` both still show QQQ, since that comes straight from `ticker` state,
not from the fetch). A faster background poll makes this MORE likely, not less — exactly the
"faster refresh makes a levels widget less correct than a static one" failure shape.

### Evidence

- RED (pre-fix behavior reproduced in isolation): a minimal re-implementation of the old
  unguarded `setSnapshot(await res.json())` pattern, fed a slower SPX response (20ms) racing a
  faster QQQ response (5ms) that resolves first, ends with the stale SPX payload applied last —
  reproducing the exact defect.
- GREEN (post-fix): `src/components/landing/home-gamma-promo-ticker-guard.test.ts` runs the real
  exported `runGuardedTickerLoad` through the identical out-of-order sequence (QQQ's own request
  resolves first and is applied; the stale SPX poll resolves afterward and is correctly dropped)
  and asserts the final applied state is still QQQ's.
- `npx tsc --noEmit` clean; both the new guard test and the existing
  `HomeGammaPromo.test.ts` source-scan tests pass together.

### Blast radius

One call site (`HomeGammaPromo.tsx`'s `loadTicker`) — this component has exactly one fetch
function driving `snapshot` state, invoked from the poll and from `selectTicker`, both of which
now funnel through the same guarded helper.

The SAME bug shape was already found and fixed once in this exact feature pair:
`src/components/tools/GammaSnapshotWidget.tsx` (the authenticated `/tools/gamma-snapshot` page's
near-identical twin, same `/api/public/gex-snapshot` endpoint, same 5s-poll-plus-click shape)
already carries an inline `wantedTicker` ref guard with a comment describing this exact race
("a 5s poll racing a ticker click can repaint SPX numbers under a QQQ heading"). `HomeGammaPromo`
is the public homepage's copy of that same panel and had never received the equivalent fix — a
duplicated-logic gap matching this repo's standing "blast radius" discipline (a second file with
the same root cause counts, even when it wasn't where the bug was first noticed).
`GammaSnapshotWidget.tsx` itself was left untouched (its own guard already works correctly) and
is noted here only as the sibling evidence that this is a known, previously-fixed-once bug shape.

### Fix rationale

Extracted a small, generic, non-React guard function,
`runGuardedTickerLoad<T>(wanted, getWantedTicker, doFetch, applyResult)`
(`src/components/landing/home-gamma-promo-ticker-guard.ts`), matching the same pattern already
used by this repo's several `*-request-guard.ts` helpers (e.g.
`admin-api-dashboard-request-guard.ts`, `x-intel-queue-request-guard.ts`) and by
`ContractDrilldownDrawer.tsx`'s `runGenerationGuardedLoad`: the caller bumps a ref
(`wantedTickerRef`) to the ticker it's now requesting BEFORE starting the fetch, and the guard
re-checks that ref's current value at settle time before handing the result to `applyResult`. A
response for a ticker that's since been superseded is dropped instead of overwriting the newer
ticker's already-correct state. The `finally` block's `setLoading(false)` is likewise gated on
still being the current ticker, so a superseded call's cleanup can't flip the spinner off while a
newer request is still in flight.

Chose a small extracted + directly-unit-tested function over mirroring `GammaSnapshotWidget.tsx`'s
inline-only pattern, so the guard's exact behavior (including the specific resolve-order that
exposed the bug) is proven with a real async test rather than only by source inspection.
Deliberately left `GammaSnapshotWidget.tsx` as-is rather than also migrating it onto the new
shared helper — its own guard is already correct, and widening this PR's scope to a working file
is unnecessary churn.
