> **kind:** FINDING

## Ask Largo swing brief: an 8.5-year-old (or wrong-entity) short-interest figure rendered under the identical `STALE` tag as a few-days-old one — FIXED

| | |
|---|---|
| **Status** | FIXED (this commit) |
| **Severity** | P3 (cosmetic/trust — no execution-path impact) |
| **Surface** | `GET /api/market/swing/play-brief` — "Short interest" evidence line |

### Root cause

`fundamentalsFreshness()` (`src/lib/swing/play-brief.ts`) feeds a fundamentals `as_of` age into
the shared `freshnessFromAgeMs()` (`src/lib/bie/answer-envelope.ts`), which has exactly four
buckets: `live` (<60s), `recent` (<10min), `unknown`, and everything else — including a figure a
few days old and one nearly a decade old — falls into one undifferentiated `stale`. There is no
upper bound past which a figure stops being merely "stale" and starts being almost certainly wrong
(a different reality than "current short interest for this ticker today").

### Evidence (three live corroborating instances, crossing this repo's standing 3-instance
threshold before a shared primitive gets touched)

- **MSTX** — short-interest `as_of: 2017-03-31`, ~9 years old. MSTX (a leveraged single-stock
  ETF) very likely didn't exist under this ticker in 2017 — almost certainly a recycled-ticker /
  wrong-entity data-provider mismatch, not real MSTX history.
- **CRCG** — `as_of: 2025-12-31` (~258 days old at read time).
- **ECO** — `as_of: 2025-12-31` (~258 days old), via a *different* call path than the other two
  (the shared `fundamentalsFreshness` → `freshnessFromAgeMs` chain, confirming the gap is
  systemic to the function, not one feed).

All three rendered the exact same one-word `STALE` tag as sibling tickers in the same batch whose
short-interest was 2-14 days old — a trader has no way to distinguish "a few days old, still
roughly informative" from "not a fact about this ticker's current state at all."

### Fix

Deliberately **narrower** than widening `BieFreshness` (a shared BIE primitive read by every
product — Vector/Helix/SPX/0DTE/Swing — widening its enum is a real cross-product design call,
not a contained fix, and this finding was originally escalated on that exact basis rather than
ride-along-fixed). Instead, applied a domain-specific ceiling at this one call site only: when the
fundamentals `as_of` age exceeds `FUNDAMENTALS_ANCIENT_CEILING_MS` (60 days — several missed
FINRA biweekly short-interest publication cycles), the evidence line is **omitted entirely**
rather than rendered under a misleading `stale` tag. This is the Largo product contract's own
absence principle ("`confidence` must be OMITTED when a product cannot calibrate it") applied to
a freshness-gated fact instead of a confidence score: omission is honest, a misleading label is
not.

### Blast radius

Single call site (`play-brief.ts`'s short-interest evidence builder). No change to
`freshnessFromAgeMs`/`BieFreshness` itself, so every other product reading that shared primitive
is untouched. A short-interest figure between 10 minutes and 60 days old still renders exactly as
before (tagged `stale`, same as pre-fix) — only the genuinely-ancient tail is newly omitted.

### Test

`src/lib/swing/play-brief.test.ts`: new test using the live-repro'd MSTX 2017 date asserts the
evidence line is `undefined` (omitted); a companion test at 45 days (under the 60-day ceiling)
asserts the line still renders, tagged `stale`, to prove the ceiling doesn't over-suppress
legitimately-old-but-plausible data. Confirmed RED (via `git stash` on the source-only change)
before the fix, GREEN after — 64/64 `play-brief.test.ts`. Full `npm test` + `tsc --noEmit` also
run.

### Provenance

Raised on the standing Ask Largo × Night Hawk Swings collaboration thread, PR #4076 (comment
5673468598, "3rd corroborating instance... now crosses the 3-instance threshold"), by the
nighthawk-swings OWNER lane.
