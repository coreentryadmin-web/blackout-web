# 2026-11-09: `fetchPolygonIvTermStructure` could cache a mid-pagination fetch failure as a complete IV term structure for 5 minutes

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

`fetchPolygonIvTermStructure` (`src/lib/providers/polygon-options-gex.ts`) paginates a Polygon/
Massive options-chain snapshot to build a ticker's full IV-term-structure curve, caching the
result in `ivTermCache` for `IV_TERM_CACHE_MS` (5 minutes). Its page-fetch helper,
`polygonFetchUrl`, deliberately returns `null` for every failure mode (non-2xx, a thrown network
error, or Polygon not configured) rather than throwing — a documented, intentional design so
best-effort callers can degrade cleanly. The pagination loop's own exit condition relies on the
SAME `null` to mean "we've reached the end of the chain":

```ts
while (page && guard < HEATMAP_PAGE_GUARD) {
  for (const c of page.results ?? []) { /* accumulate into byExpiry */ }
  if (!page.next_url) break;                       // natural end: page is still non-null here
  page = await polygonFetchUrl(page.next_url);      // re-fetch the next page
  guard += 1;
}
if (page?.next_url) warnChainTruncated("fetchPolygonIvTermStructure", root, guard);
```

Once a LATER page's re-fetch fails, `page` itself becomes `null`. The `while` condition then
exits the loop — indistinguishable, from inside the loop, from a page that legitimately had no
`next_url`. Worse, the one place that already tries to flag truncation, `warnChainTruncated`,
checks `page?.next_url`, which on a `null` page is `undefined` — always falsy — so **no warning
fires either**. The only visible trace of the failure is nothing at all: the function silently
returns whatever partial `byExpiry` map was built from the pages that DID succeed, and because
that partial map is still non-empty for any ticker with more than one page's worth of expiries
(SPX, SPY, QQQ routinely paginate), it passes the `data.length` cache-write guard unchanged:

```ts
if (data.length) {
  if (ivTermCache.size > 200) ivTermCache.clear();
  ivTermCache.set(root, { at: now, data });   // cached for 5 minutes, truncated or not
}
```

The result: a single transient blip on page 2+ (429/5xx/timeout — exactly the failure modes
`polygonFetchUrl`'s own doc comment names) silently truncates the term structure to whatever
near-dated expiries happened to load on page 1, and that truncated curve is then treated as the
confirmed, complete answer for the full 5-minute TTL — with zero signal anywhere, not even a log
line, that anything went wrong. Every consumer (`spx-signal-log.ts`'s shadow vol-divergence skew
reading, Largo's `get_iv_term_structure` tool in `run-tool.ts`) reads a falsely-complete,
missing-the-far-expiries curve as if it were real.

This is the same bug class as two sibling fixes already landed in this file/session — the GEX-
heatmap chain-less negative cache (threading a `fetchFailed` boolean through
`fetchHeatmapBandLoHi`/`Unfiltered`/`Band`) and `fetchPolygonMacroBackdrop`'s one-sided fetch
failure — but is a genuinely distinct instance: those two gate a NEGATIVE/empty-result cache
decision on confirmed-vs-failed; this one gates a NON-EMPTY-BUT-TRUNCATED result from being
mistaken for a confirmed-complete one.

### Why it wasn't caught earlier

`warnChainTruncated`'s guard (`page?.next_url`) was written to catch the guard-exhaustion case
(loop hits `HEATMAP_PAGE_GUARD` while `page.next_url` is still truthy) — a real, different failure
mode that correctly warns. Nobody noticed that the exact same check silently stops working once
`page` itself becomes `null`, because a `null` page and a `null` `next_url` produce the identical
`undefined` from optional chaining. The three sibling pagination loops in this same file
(`fetchChainBand`, `fetchHeatmapBandLoHi`, `fetchHeatmapBandUnfiltered`) share this exact shape;
this finding only fixes `fetchPolygonIvTermStructure` because it is the one instance that feeds a
multi-minute cache write directly off the loop's own accumulator with no other gate downstream —
the sibling functions either don't cache their own return value at this layer, or (per the
just-landed GEX-heatmap fix) already have an independent `fetchFailed` signal gating their
specific negative-cache decision.

## Blast radius

Only `fetchPolygonIvTermStructure` writes to `ivTermCache`, and only one cache key per ticker
exists. Grepped every `polygonFetchUrl` call site in the file (`fetchChainBand`,
`fetchHeatmapBandLoHi`, `fetchHeatmapBandUnfiltered`, `fetchPolygonAtmChainAllExpiries`) — none of
the others write their raw accumulator straight into a time-boxed cache the way this one does, so
this is the one place this exact caching-partial-as-complete shape occurs in this file.

## Fix

Capture the later-page re-fetch result into a local `next` before assigning it to `page`, so a
`null` can be flagged as a genuine failure before it collapses into the same state the loop's
natural-end `break` already produces. Set `midPaginationFetchFailed = true` when `next == null`,
log a `console.warn` naming the ticker so the failure is visible at all, and gate the
`ivTermCache.set` write on `!midPaginationFetchFailed` in addition to the existing `data.length`
check. A genuinely complete chain — the loop exits via `break` on a falsy `next_url`, never via a
failed re-fetch — caches exactly as before; nothing about the success path changed.

**Deliberately left unchanged:** the sibling `polygonFetchUrl` call sites in `fetchChainBand`,
`fetchHeatmapBandLoHi`/`Unfiltered`, and `fetchPolygonAtmChainAllExpiries`. None of them write
their own raw loop output directly into a standalone time-boxed cache the way this function does
(the heatmap pair already has its own `fetchFailed` signal wired into its specific negative-cache
decision, landed earlier this session); fixing them here would be scope creep on a lead this
finding didn't establish for them.

## Evidence

New regression test in `polygon-options-gex.test.ts` (source-pattern assertion, same style as the
sibling page-guard test for this same function two tests above it — pagination over a live
network isn't practically unit-testable without heavy mocking in this file's existing test
style). RED confirmed via `git stash` isolating `polygon-options-gex.ts`: 77/78 pass, 1 fail
(the new test) pre-fix. GREEN post-fix: 78/78 pass. `npx tsc --noEmit` clean.

## Files changed

- `src/lib/providers/polygon-options-gex.ts` — the fix.
- `src/lib/providers/polygon-options-gex.test.ts` — regression test.
- `docs/audit/MARKET-OPEN-VALIDATION.md` — WATCH LIST entry.
