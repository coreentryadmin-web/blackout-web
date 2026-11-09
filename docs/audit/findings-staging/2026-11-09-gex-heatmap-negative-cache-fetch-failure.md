# 2026-11-09: GEX heatmap chain-less negative cache could pin a transient Polygon/UW fetch failure as "confirmed chain-less" for 10 minutes

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

`buildGexHeatmapUncached` (`src/lib/providers/polygon-options-gex.ts`) marks a root "confirmed
chain-less" (`markNoChainTicker`, `NO_CHAIN_NEGATIVE_TTL_SEC = 600`) and short-circuits the next
~6-7 rebuild cycles whenever the banded Polygon chain fetch AND the UW spot-exposures fallback
both come back with zero contracts/strikes. That negative cache is a real, deliberate,
well-evidenced fix (2026-09-18: ACEEU/RWTN hammered both upstreams every ~75-90s for 90+ minutes
because a genuinely dead/no-options ticker's 0-contracts result was never remembered). But the
condition it fires on — "both upstream calls produced zero" — was, before this fix, EXACTLY the
same observable outcome whether Polygon/UW genuinely confirmed an empty chain OR the fetch simply
never got an answer (rate-limited, 403'd, timed out, or the circuit breaker was open with no stale
cache). `polygonFetchUrl` collapses "not configured", any non-2xx (403/429/5xx) and a thrown
network error into the identical `null` it also never uses for "confirmed empty" (a real 200 with
zero results is a different, non-null parsed body) — but the *caller* (`fetchHeatmapBandLoHi`/
`fetchHeatmapBandUnfiltered`) discarded that distinction entirely before this fix, returning the
same `{ contracts: [] }` either way. `fetchUwSpotExposuresByStrike` had the identical collapse one
level down (`uwGetSafe` resolves not-configured/403/circuit-open/exhausted-retries to `null`, and
`extractRows(null)` is `[]`, same as a genuinely-answered-empty page).

Net effect pre-fix: a single rate-limited or transiently-failing poll on a perfectly normal,
liquid ticker — exactly the kind of blip `UW_GLOBAL_MAX_RPS`'s shared 2-rps ceiling and this
toolkit's own "UW rate-limiter queue timeouts surging" incidents (CLAUDE.md, 2026-09-17) show
happen live during RTH — could get that ticker's heatmap pinned to an all-empty matrix for a full
10 minutes, with the member-facing board unable to recover until the TTL expired, even though the
chain was never actually gone. This is the inverse failure mode of the bug the negative cache was
built to fix: instead of "never cache a transient blip," it was "confidently cache one as
permanent."

## Root cause

```ts
// before (fetchHeatmapBandLoHi / fetchHeatmapBandUnfiltered)
let page = await polygonFetchUrl(url);   // null on EITHER a genuine 200-empty-response-shaped
                                          // failure (not configured/403/429/5xx/throw) ...
const out: ChainContract[] = [];
while (page && guard < CAP) { out.push(...(page.results ?? [])); ... }
return { contracts: out, truncated };    // ... both end up as the SAME { contracts: [] }

// before (buildGexHeatmapFromUwStrikeExposures)
const rows = await fetchUwSpotExposuresByStrike(root, 500);
if (!rows?.length) return null;          // same collapse: uwGetSafe failure vs genuine empty

// before (buildGexHeatmapUncached)
if (!contracts.length) {
  const uwMatrix = await buildGexHeatmapFromUwStrikeExposures(...);
  if (uwMatrix) return uwMatrix;
  markNoChainTicker(root, now);          // fires on "both empty", no way to tell confirmed from failed
  return emptyHeatmap(...);
}
```

Nothing downstream of `polygonFetchUrl`/`fetchUwSpotExposuresByStrike` ever had the information
needed to tell "Polygon/UW definitively answered: no chain here" apart from "the request never
actually completed" — both were thrown away at the exact point they would have mattered, the same
general shape as the sibling `fetchDailyMarketSummary(...).catch(() => null)` finding staged
earlier today and the `fetchUwTickerFlowAlertsResult` fix (#7788, also merged today) that this fix
follows the same precedent as.

## Evidence (RED → GREEN)

RED (pre-fix, via `git stash` isolating only the two source files
`src/lib/providers/polygon-options-gex.ts` and `src/lib/providers/unusual-whales.ts` while keeping
the new regression tests in place):

```
not ok 36 - chain-less root ... is negative-cached and short-circuits the NEXT build before any upstream call
  error: 'markNoChainTicker must run only after the UW fallback also resolved'
not ok ... - markNoChainTicker is gated on BOTH upstreams being CONFIRMED empty ...
not ok 134 - fetchUwSpotExposuresByStrikeResult: failed:true when the upstream never answered (403) ...
  error: "fetchUwSpotExposuresByStrikeResult is not a function" (does not exist pre-fix)
not ok 135 - fetchUwSpotExposuresByStrikeResult: failed:false when UW genuinely answered with zero exposures
not ok 136 - fetchUwSpotExposuresByStrikeResult: the pre-fix collapse ...
# tests 140, pass 135, fail 5
```

GREEN (post-fix, source files restored via `git stash pop`):

```
# tests 140, pass 140, fail 0
```

Also ran `npx tsc --noEmit` (Node 20.20.2): clean. `npx eslint` on all four touched files: clean.

## Fix

Threaded a `fetchFailed`/`failed` boolean through the exact call chain the negative-cache decision
depends on, following the same `{ ...payload, failed: boolean }` Result-shape precedent
`fetchUwTickerFlowAlertsResult` just established (#7788) rather than changing any existing
function's non-nullable contract:

- `fetchHeatmapBandLoHi` / `fetchHeatmapBandUnfiltered` now also return `fetchFailed: boolean`,
  true iff their own FIRST page request returned `null` (never got any confirmed response). A
  `null` on a LATER paginated page (after `next_url`) does NOT count — the contracts already
  collected on earlier pages are real, so pagination stopping early is a truncation concern
  (already handled by `truncated`), not a fetch-failure one.
- `fetchHeatmapBand` propagates this: `shouldEscalateToFullChain` always fires when the banded
  pull returns 0 strikes (both its thresholds — 12 and 45 — are positive, and the caller already
  guarantees `spot > 0` before calling it), so whenever the final `contracts` ends up empty, the
  full-chain escalation ALWAYS ran. Its `fetchFailed` is therefore the decisive signal, overriding
  the banded fetch's own value in both the "adopted" and "no-op" branches: a confirmed-empty
  full-chain response settles the question even if the banded pull itself happened to fail, and a
  FAILED full-chain response must never be read as confirmation even if the banded pull itself
  happened to succeed empty.
- New `fetchUwSpotExposuresByStrikeResult` (unusual-whales.ts) — a sibling of the untouched
  `fetchUwSpotExposuresByStrike` (which keeps its existing callers, `gex-cross-validation.ts` and
  `largo/run-tool.ts`, unchanged) — returns `{ rows, failed: data == null }`, identical style to
  `fetchUwDarkPool`'s `if (data == null) return null` guard and `fetchUwTickerFlowAlertsResult`.
- `buildGexHeatmapFromUwStrikeExposures` now returns `{ heatmap: GexHeatmap | null; fetchFailed:
  boolean }` using the Result variant above. A genuine answer with zero/filtered-out rows is
  `fetchFailed: false` (that's a real filter outcome, not an ambiguity this fix addresses); a
  caught exception mid-build is treated as `fetchFailed: true` (conservative — better to skip a
  negative-cache mark than risk one off a local bug).
- `buildGexHeatmapUncached` now only calls `markNoChainTicker` when
  `!chainResult.fetchFailed && !uwResult.fetchFailed`. On a transient failure on either side, it
  falls through to the normal (short, `EMPTY_SPOT_NEGATIVE_TTL_MS`-scale) empty-heatmap path
  instead — exactly the behavior this file had BEFORE the negative cache existed, so a transient
  blip is retried on the next ordinary rebuild cycle rather than pinned for 10 minutes.

### What was deliberately left unchanged

The original ACEEU/RWTN fix is fully preserved: a genuinely dead/no-options root still gets
negative-cached exactly as before, because a real delisted ticker's chain requests resolve with
confirmed (non-null, `fetchFailed: false`) empty responses from both Polygon and UW, not failures.
Nothing about `NO_CHAIN_NEGATIVE_TTL_SEC`'s value, `isKnownNoChainTicker`'s short-circuit ordering
(still before the spot fetch), or the short-circuit's own Redis-fail-open behavior changed. The
three OTHER `polygonFetchUrl` call sites in this same file (the OI-by-expiry term-structure loop,
a greeks/last-quote loop, and the unified OCC snapshot loop) do not feed this negative-cache
decision at all and were left untouched — a separate concern, out of scope here.

## Blast radius

`src/lib/providers/polygon-options-gex.ts`: `fetchHeatmapBandLoHi`, `fetchHeatmapBandUnfiltered`,
`fetchHeatmapBand`, `buildGexHeatmapFromUwStrikeExposures`, `buildGexHeatmapUncached` — all five
return-type/call-site changes are internal to this one file; repo-wide grep confirmed no other
module imports any of them (they are all unexported). `src/lib/providers/unusual-whales.ts`: one
new exported function (`fetchUwSpotExposuresByStrikeResult`) added alongside the existing
`fetchUwSpotExposuresByStrike`, which keeps its current signature and both of its existing callers
(`gex-cross-validation.ts`, `largo/run-tool.ts`) completely unchanged — repo-wide grep confirmed.
Two pre-existing tests needed updates to match the new code shape (not new assertions, just
following the same variable/structure rename): the `markNoChainTicker` ordering test in
`polygon-options-gex.test.ts` (`uwMatrix` → `uwResult.heatmap`) and the `gex-regime-invariant.test.ts`
source-text scan (unaffected by signature — only checks the function body excludes
`walls_by_horizon`, confirmed still passing).
