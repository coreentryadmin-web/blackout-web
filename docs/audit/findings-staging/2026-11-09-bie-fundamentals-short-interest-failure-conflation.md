# 2026-11-09: BIE ecosystem fundamentals/short-interest leg conflates a failed Polygon fetch with confirmed structural absence

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

`assembleEcosystemArsenal` (`src/lib/bie/ecosystem-context.ts`) has three sibling single-name
"leg" checks — earnings, fundamentals/short-interest, and news — each deciding whether a data
source is genuinely absent for a ticker vs. a failed fetch. This is the **third** time this exact
conflation has been found in this one function: the `news` leg already does it correctly
(`NewsResult.unavailable`), and the `earnings` leg was fixed for exactly this bug the day before
(`docs/audit/findings-staging/2026-11-08-bie-earnings-absence-mislabels-fetch-failure.md`, PR
#7584, merged as commit `7df37da25`). The `fundamentals/short-interest` leg — sitting physically
between those two legs in the same function — was missed by both passes.

Live repro (2026-11-09, `GET /api/market/swing/play-brief`): TSLA (WATCH) and MSTR (CLOSED) — two
of the most heavily-shorted, most liquid US equities — both carried
`{"source":"fundamentals/short-interest","reason":"no data for ticker","retryable":false}` in
`unavailableSources`. The in-code comment at the push site asserted this is "Structural: this
provider simply carries no short-interest series for the name (common for thinly-shorted or
newly-listed tickers)" — a claim that does not describe either name. Given this repo's CLAUDE.md
already documents a live, currently-open real-time Polygon/Massive entitlement 403 outage
("ENTITLEMENT REGRESSED 2026-11-07"), the far more plausible explanation is that the underlying
fetch failed and got silently relabeled as a confident, non-retryable absence.

### Root cause

`fetchShortInterest`/`fetchShortVolume` (`src/lib/providers/polygon.ts`) each wrapped their fetch
in a bare `try { ... } catch { return null }` / `catch { return [] }`, with no error signal
threaded out at all:

```ts
// before
export async function fetchShortInterest(ticker: string, signal?: AbortSignal) {
  try {
    const data = await polygonGet(...);
    const row = data.results?.[0];
    if (!row) return null;
    return shapeShortInterestRow(row, sym);
  } catch {
    return null; // a 403/429/timeout is indistinguishable from "genuinely nothing"
  }
}
```

`fetchTickerFundamentalsBundle` (`src/lib/bie/ticker-fundamentals.ts`) further swallowed the same
way (`fetchShortInterest(sym).catch(() => null)`, `fetchShortVolume(sym, 5).catch(() => [])`), so
by the time `assembleEcosystemArsenal` saw the bundle, a failed fetch and a genuinely empty one
were bitwise identical — both just `short_interest: null, short_volume_ratio: null`. The leg then
unconditionally reported the structural-absence entry:

```ts
// before (ecosystem-context.ts, ~line 467)
const fundamentals = single
  ? reads.fundamentals && (reads.fundamentals.short_interest?.days_to_cover != null || reads.fundamentals.short_volume_ratio != null)
    ? { ... }
    : (unavailable.push({
        source: "fundamentals/short-interest",
        reason: "no data for ticker",
        retryable: false, // fabricated certainty for BOTH "no data" and "fetch failed"
      }), null)
  : null;
```

This is precisely the Largo product-contract absence-principle violation
(`docs/audit/LARGO-PRODUCT-CONTRACT.md`) the earnings-leg fix (#7584) already named and fixed for
its own sibling leg one day earlier — the same root-cause SHAPE, a third independent instance in
the same function, not a duplicate of either prior fix.

### Blast radius

`ecosystem-context.ts`'s `fundamentals` arsenal leg is a shared reader (per this file's own
`arsenal:` tool-doc comment) consumed by every ticker-scoped BIE/Largo surface — not just the swing
play-brief that surfaced the live repro. Every consumer inherits the same false-confident "no data"
signal whenever the underlying Polygon short-interest/short-volume fetch fails for any reason (the
currently-open entitlement outage, a transient rate limit, a timeout).

One prior finding for this exact leg (#4864, commit `f2ee93913`) added `what_is_missing`/
`retryable` fields but explicitly classified `fundamentals/short-interest` as "retry is futile /
structural" — baking in the same flawed absence-vs-failure assumption the earnings-leg fix (#7584)
later overturned for its sibling leg. This PR corrects that same baked-in assumption here.

## Evidence (RED → GREEN)

RED (pre-fix, via `git checkout origin/main -- src/lib/providers/polygon.ts
src/lib/bie/ticker-fundamentals.ts src/lib/bie/ecosystem-context.ts`, isolating only the three
source-file changes while keeping every new regression test in place):

```
not ok - assembleEcosystemArsenal: a FAILED short-interest fetch is retryable:true with the real cause...
not ok - assembleEcosystemArsenal: a FAILED short-volume fetch is retryable:true with the real cause
not ok - assembleEcosystemArsenal: BOTH short-interest and short-volume failing together is still retryable:true...
not ok - fetchTickerFundamentalsBundle: a genuine empty-but-successful read carries short_interest_error/short_volume_error as null...
not ok - fetchTickerFundamentalsBundle: a FAILED short-interest fetch carries the real error into the bundle
not ok - fetchTickerFundamentalsBundle: a FAILED short-volume fetch carries the real error into the bundle
not ok - fetchTickerFundamentalsBundle: BOTH legs failing together carry both real errors independently...
not ok - fetchTickerFundamentalsBundle: a real successful short-interest row still parses correctly...
not ok - assembleFundamentalsBundle: short_interest_error/short_volume_error default to null when omitted...
not ok - assembleFundamentalsBundle: a FAILED short-interest fetch carries the real error through...
not ok - assembleFundamentalsBundle: a FAILED short-volume fetch carries the real error through...
not ok - assembleFundamentalsBundle: BOTH legs failing together carry both real errors independently
not ok - fetchShortInterestResult: a genuine successful-empty fetch returns {row: null, error: null}...
not ok - fetchShortInterestResult: a FAILED fetch (403 not-entitled) carries the real error...
not ok - fetchShortInterestResult: a real row still parses correctly (no regression)
not ok - fetchShortVolumeResult: a genuine successful-empty fetch returns {rows: [], error: null}...
not ok - fetchShortVolumeResult: a FAILED fetch (429 rate-limited) carries the real error...
not ok - fetchShortVolumeResult: a real row still parses correctly (no regression)
not ok - fetchShortInterestResult / fetchShortVolumeResult BOTH failing together carry both real errors...
# tests 74, pass 55, fail 19
```

GREEN (post-fix, source files restored):

```
# tests 74, pass 74, fail 0
```

Also re-ran every pre-existing sibling test file this change touches or is adjacent to —
`polygon-short-interest-absence.test.ts`, `polygon-short-interest-cancellation.test.ts`,
`uw-earnings.test.ts`, `meridian-benzinga-earnings.test.ts`, `dossier.test.ts` (nighthawk + swing),
`run-tool.test.ts`, `run-tool-quote-change.test.ts`, `edition-builder-dossier-fetch-retry.test.ts`
— all pass unchanged (0 regressions; `fetchShortInterest`/`fetchShortVolume`'s own "never throw"
contract for their pre-existing callers is explicitly asserted unaffected by two new tests).
`npx tsc --noEmit` (Node 20.20.2): clean.

## Fix

Mirrors the earnings/news legs' exact shape, three layers:

1. **`polygon.ts`** — `fetchShortInterest`/`fetchShortVolume` are refactored to delegate to a
   shared private inner fetch (`fetchShortInterestRow`/`fetchShortVolumeRows`) that throws on
   failure; the two public functions are **completely unchanged in behavior** (same try/catch,
   same "never throw, resolve null/[] on any miss" contract — verified by two new tests asserting
   this explicitly). Two new **additive** sibling functions, `fetchShortInterestResult`/
   `fetchShortVolumeResult`, call the same inner fetch and surface the real outcome instead of
   swallowing it: `Promise<{ row: ShortInterestRow | null; error: string | null }>` and
   `Promise<{ rows: ShortVolumeRow[]; error: string | null }>`.
2. **`ticker-fundamentals.ts`** — `TickerFundamentalsBundle` gains two additive, optional-shaped
   fields, `short_interest_error`/`short_volume_error` (both `null` unless the respective fetch
   genuinely failed). `fetchTickerFundamentalsBundle` now calls the `*Result` wrappers instead of
   `fetchShortInterest(sym).catch(() => null)`/`fetchShortVolume(sym, 5).catch(() => [])`, and
   `assembleFundamentalsBundle` threads the two error fields through (both default to `null` when
   omitted, so every pre-existing call site/test of `assembleFundamentalsBundle` is unaffected).
3. **`ecosystem-context.ts`** — the fundamentals leg now checks
   `reads.fundamentals?.short_interest_error || reads.fundamentals?.short_volume_error` BEFORE
   falling back to the structural-absence branch, exactly like the earnings leg's `.error` check.
   On either error being set, it pushes `{reason: "short-interest/short-volume unavailable:
   <real cause>", retryable: true}` instead of the generic `{reason: "no data for ticker",
   retryable: false}`. A genuine clean miss (both error fields `null`) keeps the exact pre-existing
   output byte-for-byte.

### What was deliberately left unchanged

- `fetchShortInterest`/`fetchShortVolume` themselves — their existing callers (`dossier.ts` ×2,
  `run-tool.ts` ×2) get the identical behavior as before this PR; this is purely additive.
- The genuine-structural-absence output shape (`{reason: "no data for ticker", retryable: false}`)
  — a real successful-but-empty fetch for a thinly-shorted/newly-listed ticker still produces this
  exact entry, unchanged.
- `fetchTickerFundamentalsBundle`'s cache key/TTL and its other legs (ratios, signals, price
  target) — untouched, out of scope for this leg-specific fix.
- The underlying Polygon/Massive real-time entitlement outage itself is **not fixable from this
  codebase** (CLAUDE.md's own note: needs the operator to check/renew the plan on Massive.com).
  This PR only makes the existing honest-fetch-failure signal reach the consumer instead of being
  silently relabeled as permanent absence — it does not retry past, route around, or paper over
  the outage.

## Related

- `docs/audit/findings-staging/2026-11-08-bie-earnings-absence-mislabels-fetch-failure.md` (PR
  #7584, merged) — the sibling `earnings` leg fix this PR mirrors exactly.
- The `news` leg (`ecosystem-context.ts`, ~line 539) already implemented this split correctly via
  `NewsResult.unavailable` and needed no change.
