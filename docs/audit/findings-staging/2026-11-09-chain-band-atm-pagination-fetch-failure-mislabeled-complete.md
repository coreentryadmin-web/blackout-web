# 2026-11-09: `fetchChainBand`/`fetchPolygonAtmChainAllExpiries` pagination loops read a FAILED mid-chain re-fetch as "chain complete", not truncated

> **kind:** `FINDING`

**Status.** FIXED — this PR (observability-only; a larger follow-up is scoped below, not fixed here).

## Summary

`fetchChainBand` and `fetchPolygonAtmChainAllExpiries` (`src/lib/providers/polygon-options-gex.ts`)
are the two remaining instances of a bug class this session has now fixed four other times in the
same file: `fetchHeatmapBandLoHi`/`fetchHeatmapBandUnfiltered`/`fetchPolygonOiByExpiry` (PR #7805)
and `fetchPolygonIvTermStructure` (PR #7804). Both derived their only truncation signal from the
FINAL page object after their pagination loop exits, which collapses a genuinely failed
mid-pagination re-fetch into the exact same falsy signal a clean, complete fetch produces.

- `fetchChainBand` feeds the Largo-facing `fetchPolygonOptionsChain`/`fetchPolygonAtmOptionsChain`
  tools and `fetchFrontExpiryGammaCoeffs`'s intraday-adjusted dollar-gamma coefficients. It
  already had a `warnChainTruncated` call, but the call's guard condition (`page?.next_url`)
  never fired on a genuine mid-band failure — the warning was present but silently dead on the
  one path that mattered most (a real upstream hiccup, not guard exhaustion).
- `fetchPolygonAtmChainAllExpiries` feeds Night Hawk's `resolveTickerChainRows`
  (`src/features/nighthawk/lib/option-chain-prompt.ts`), the primary path for discovering
  expiries + chain data in one round-trip. It had NO truncation signal at all — not even a
  broken one — so a partial, all-expiries chain silently looked complete to its only caller.

## Root cause

```ts
// pre-fix shape, both sites
let page = await polygonFetchUrl(...);
let guard = 0;
while (page && guard < CHAIN_BAND_PAGE_GUARD) {
  out.push(...(page.results ?? []));
  if (!page.next_url) break;           // real end — caught correctly
  page = await polygonFetchUrl(page.next_url); // re-fetch a KNOWN next page
  guard += 1;
}
// fetchChainBand only: const truncated-ish check derived solely from final `page`
if (page?.next_url) warnChainTruncated(...);  // BUG: page is null on a failed re-fetch too
```

`polygonFetchUrl` deliberately returns `null` on ANY failure (non-2xx, a thrown network error, or
not configured) rather than throwing. Both loops only ever re-fetch a page once a PRIOR page's
own `next_url` has already proven more data exists — the real end is caught by `!page.next_url`,
which `break`s BEFORE any re-fetch is attempted — so a `null` result from that re-fetch can only
mean the known-good next page failed to load, never a legitimate end-of-chain signal. Once that
re-fetch fails, `page` itself is `null`, and `page?.next_url` reads `undefined` exactly as it
would after a clean, complete fetch. A genuine mid-chain failure and a correct completion were
indistinguishable from outside the loop.

## Evidence (RED → GREEN)

New regression test (`polygon-options-gex.test.ts`) asserts the actual source (pagination over a
live network fetch isn't practically unit-testable without heavy mocking in this file's existing
style — same convention as the four sibling fixes' own tests): each site must track a
`midPaginationFetchFailed` flag, set it the moment a re-fetch comes back `null`, and OR it into
the truncation decision rather than deriving truncation solely from the final page's own
`next_url`.

RED (pre-fix, isolating only `polygon-options-gex.ts` via `git stash`, keeping the new test file):
78/79 pass, 1 fail (the new test, failing against the real pre-fix source for both functions).

GREEN (post-fix): 79/79 pass. `npx tsc --noEmit` (Node 20): clean.

## Fix

Capture each later-page re-fetch into a local `next` before assigning it to `page`, so a `null`
can be flagged as a genuine failure (`midPaginationFetchFailed = true`) before it collapses into
the loop's natural-end state. For `fetchChainBand`, the existing `warnChainTruncated` call's guard
now ORs in that flag. For `fetchPolygonAtmChainAllExpiries`, a NEW `warnChainTruncated` call is
added (mirroring the pattern every sibling pagination loop in this file already uses) — this
function previously had no truncation signal whatsoever. The success path — loop exits via
`break` on a falsy `next_url`, never via a failed re-fetch — is byte-for-byte unchanged in both
functions. Neither function's return type changed, so no caller was touched.

## Blast radius

- `fetchChainBand` → `fetchPolygonOptionsChain`/`fetchPolygonAtmOptionsChain` (Largo's
  near-the-money options-chain tools) and `fetchFrontExpiryGammaCoeffs` (the intraday-adjusted GEX
  dollar-gamma coefficient feed) — all can now see a `[polygon-gex] fetchChainBand(...)
  truncated: ...` warning when a transient Polygon failure leaves one of these partial, instead of
  it silently reading as complete.
- `fetchPolygonAtmChainAllExpiries` → `resolveTickerChainRows` (Night Hawk's ATM chain/expiry
  discovery, `option-chain-prompt.ts`) — same restored observability, previously absent entirely.

## Deliberately left unchanged (follow-up scope, not this PR)

Neither function's RETURN TYPE changed — both still return a bare `ChainContract[]`, so a caller
reading the array alone still cannot distinguish "complete" from "partial but a warning was
logged." Widening the return type (e.g. `{ contracts, truncated }`) and updating every caller to
read and act on `truncated` would meaningfully reduce the blast radius further (a caller could
retry, or at least label a downstream read as uncertain) but is a materially larger, riskier
change than this PR's — it touches `fetchFrontExpiryGammaCoeffs`, `fetchPolygonOptionsChain`,
`fetchPolygonAtmOptionsChain`, and `resolveTickerChainRows`, several of which are consumed inside
`server-only`-gated modules this session's tooling cannot directly unit-test end-to-end. This
observability-only fix is the safely-scoped first step; the type-widening change is a good target
for a dedicated future round with room to verify every caller carefully.
