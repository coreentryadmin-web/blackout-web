# 2026-11-09: GEX heatmap/chain-band/OI-by-expiry pagination loops read a FAILED mid-chain re-fetch as "chain complete", not truncated

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

Three Polygon options-chain pagination loops in `src/lib/providers/polygon-options-gex.ts` —
`fetchHeatmapBandLoHi`, `fetchHeatmapBandUnfiltered` (both feed `fetchHeatmapBand`, which builds
the GEX heatmap/matrix the whole platform's GEX walls/OI/dealer-exposure reads come from), and
`fetchPolygonOiByExpiry` (the live per-request OI-by-expiry helper Night Hawk's option-chain
prompt and Largo's `get_iv_term_structure`-adjacent tooling call) — derived their truncation
signal SOLELY from the final page object after the loop exits. That collapses a genuinely failed
mid-pagination re-fetch into the exact same falsy signal a clean, complete fetch produces, so a
transient Polygon hiccup on a later page silently returns a PARTIAL chain/ladder with
`chain_truncated` never set on the cached `GexHeatmap` and no truncation warning logged anywhere.

This is the same bug class as the sibling fix for `fetchPolygonIvTermStructure`'s mid-pagination
cache poisoning (separately raised this session, PR #7804, open at the time of this write-up) —
but a genuinely distinct instance: that PR explicitly scoped itself to the ONE function that
writes its raw loop output into a standalone time-boxed cache, and deliberately left these three
untouched as "scope creep on a lead this finding didn't establish for them." That reasoning holds
for `fetchPolygonOiByExpiry` (no standalone cache, only a lost `console.warn`), but not for the
heatmap pair: `fetchHeatmapBandLoHi`/`fetchHeatmapBandUnfiltered`'s own `truncated` boolean feeds
`fetchHeatmapBand`'s `truncated`, which becomes `chainTruncated` in `buildGexHeatmapUncached`,
which is published as `chain_truncated: true` on the `GexHeatmap` object — and THAT object is
cached for the full matrix TTL. So the identical bug class silently produces a cached, "complete"
-looking GEX matrix (walls/OI/net-gamma all understated, not flagged) one layer further out than
the function PR #7804 fixed, not merely a console log gap.

**Also collides with, but composes cleanly alongside, a second concurrent PR**: #7801 (merged to
`main` the same day, just before this one was opened) independently threaded a DIFFERENT
`fetchFailed` boolean through these exact same three functions — `fetchFailed = page == null`,
captured once right after the FIRST request only, feeding `buildGexHeatmapUncached`'s chain-less
negative-cache decision. That signal does NOT cover a later-page failure (its own comment says so
explicitly: "a null on a LATER page ... just stops pagination early"), so it does not fix — and
does not overlap in effect with — the bug this finding addresses. This branch was rebased onto
#7801 after it merged; the two fixes auto-merged cleanly (disjoint concerns: "did the first
request ever answer" vs "did a later, known-good page fail"), confirmed by re-running the RED→
GREEN proof against the post-#7801 source.

## Root cause

```ts
// pre-fix shape, all three sites
let page = await polygonFetchUrl(...);
let guard = 0;
while (page && guard < PAGE_GUARD) {
  out.push(...(page.results ?? []));
  if (!page.next_url) break;           // real end — caught correctly
  page = await polygonFetchUrl(page.next_url); // re-fetch a KNOWN next page
  guard += 1;
}
const truncated = !!page?.next_url;    // BUG: page is null on a failed re-fetch too
```

`polygonFetchUrl`/`polygonRefFetch` both deliberately return `null` on ANY failure (non-2xx, a
thrown network error, or not configured) rather than throwing — a documented, intentional
degrade-cleanly design elsewhere in this file. The loop only ever re-fetches a page once a PRIOR
page's own `next_url` has already proven more data exists (the real end is caught by
`!page.next_url`, which `break`s BEFORE any re-fetch is attempted), so a `null` result from that
re-fetch can ONLY mean the known-good next page failed to load — it is never a legitimate
end-of-chain signal. But once that re-fetch fails, `page` itself is `null`, and `page?.next_url`
reads `undefined` exactly as it would after a clean, complete fetch. A genuine mid-chain failure
and a correct completion were indistinguishable from outside the loop.

## Evidence (RED → GREEN)

New regression test asserts the actual source (pagination over a live network fetch isn't
practically unit-testable without heavy mocking in this file's existing style — same tradeoff as
the `HEATMAP_PAGE_GUARD`/`fetchPolygonIvTermStructure` tests already in this file): each of the
three sites must track a `midPaginationFetchFailed` flag, set it the moment a re-fetch comes back
`null`, and OR it into the truncation decision rather than deriving truncation solely from the
final page's own `next_url`.

RED (pre-fix, isolating only `polygon-options-gex.ts` — swapped to the real `origin/main` HEAD,
i.e. post-#7801/pre-this-fix, with this PR's test file kept): 78/79 pass, 1 fail (the new test,
failing against the real pre-fix source for all three functions in turn).

GREEN (post-fix): 79/79 pass. `npx tsc --noEmit` (Node 20): clean.

## Fix

Capture each later-page re-fetch into a local `next` before assigning it to `page`, so a `null`
can be flagged as a genuine failure (`midPaginationFetchFailed = true`) before it collapses into
the loop's natural-end state. `truncated` (or the `warnChainTruncated` gate, for
`fetchPolygonOiByExpiry`, which has no `truncated` return value at all) now ORs in that flag. The
success path — loop exits via `break` on a falsy `next_url`, never via a failed re-fetch — is
byte-for-byte unchanged.

## Blast radius

- `fetchHeatmapBandLoHi`/`fetchHeatmapBandUnfiltered` → `fetchHeatmapBand` → `chainTruncated` →
  `GexHeatmap.chain_truncated` — every GEX heatmap/matrix consumer (the `/heatmap` page, Night
  Hawk's GEX walls, Largo's heatmap-backed tool reads) can now actually see when a transient
  Polygon failure left the cached matrix partial, instead of it silently reading as complete.
- `fetchPolygonOiByExpiry` → its own `warnChainTruncated` observability signal — this function has
  no `truncated` field in its return type to callers (`option-chain-prompt.ts`,
  `run-tool.ts`), so the fix here restores the lost log signal rather than changing a caller
  contract; widening its return type to expose `truncated` to callers would be a separate,
  larger-blast-radius change, deliberately left out of this PR.
- **Deliberately left unchanged**: `fetchChainBand` (~line 4480) and
  `fetchPolygonAtmChainAllExpiries` (~line 4674) share the identical loop shape but don't return
  any truncation signal to their callers at all today (`fetchChainBand` only has a `console.warn`
  gated the same broken way; `fetchPolygonAtmChainAllExpiries` has no signal whatsoever) — adding
  one would change their return type and is a larger, separate change than this finding
  established evidence for. Noted for a follow-up round.
- `fetchPolygonIvTermStructure`'s own instance of this exact bug is the subject of a separate,
  already-open PR (#7804) — not touched here to avoid duplicating or conflicting with that work.
