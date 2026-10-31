> **kind:** FINDING

## Night Hawk Swings — biotech/solar theme-cluster gap (VKTX/SRPT/SMMT/IBRX/CAPR/REPL, SEDG/ENPH) — FIXED

**Status:** FIXED (`fix/swing-biotech-solar-theme-gap`)

Standing Ask Largo × Night Hawk Swings ownership mandate live sweep (`CLAUDE.md`), same gap
shape as every prior `sector-map.ts` extension (ALAB/CRDO/KLAC, quantum-computing, biotech,
precious-metals, cybersecurity/software).

### Root cause

`checkPortfolioOverlap` (portfolio.ts) clusters book positions by `(resolveTheme(ticker),
direction)` to flag same-thesis concentration in each play-brief's "Book context" section.
`resolveTheme` falls through to `sectorFor` (`src/lib/portfolio/sector-map.ts`), a curated static
ticker→sector map; an unmapped ticker resolves to its own isolated `NAME:<ticker>` cluster and can
never be flagged as sharing a thesis with anything else.

Live-queried the real committed Swing book (`GET /api/market/nighthawk/horizons?view=swings`,
`board.lanes.SWING.committed`, 58 positions) and ran `resolveTheme` against every ticker. Two real
gaps surfaced:

1. **Biotech:** VKTX (positionId 2298), SRPT (2231), SMMT (2219), IBRX (2215), CAPR (2313) and REPL
   (2303) were all concurrently LONG/COMMIT alongside NVAX (2272, 2222 — already in the `biotech`
   bucket) — the identical clinical/commercial-stage binary-catalyst risk driver as the existing
   NTLA/CRSP/VIR/MIRM/IONS/NVAX/IOVA/PCVX/TNGX/RLAY/ABVX cohort, but all six were unmapped, so each
   resolved to its own isolated cluster and no play-brief's Book-context section could see the
   7-position single-thesis concentration.
2. **Solar:** SEDG (2307) and ENPH (2248) were concurrently LONG/COMMIT, both unmapped, resolving
   to isolated `NAME:SEDG`/`NAME:ENPH` clusters — the two dominant residential-solar
   power-electronics (inverter/optimizer) makers, correlated on rate sensitivity and
   residential-solar policy/tariff news, with no Book-context flag at all.

### Evidence

Verified every added ticker via Polygon reference (`/v3/reference/tickers/<T>`), not guessed from
the symbol:

| Ticker | SIC | SIC description | Bucket |
|---|---|---|---|
| VKTX | 2834 | PHARMACEUTICAL PREPARATIONS | biotech |
| SRPT | 2834 | PHARMACEUTICAL PREPARATIONS | biotech |
| SMMT | 2834 | PHARMACEUTICAL PREPARATIONS | biotech |
| IBRX | 2836 | BIOLOGICAL PRODUCTS | biotech |
| CAPR | 2834 | PHARMACEUTICAL PREPARATIONS | biotech |
| REPL | 2836 | BIOLOGICAL PRODUCTS | biotech |
| SEDG | 3674 | SEMICONDUCTORS & RELATED DEVICES | solar |
| ENPH | 3674 | SEMICONDUCTORS & RELATED DEVICES | solar |

**Deliberately excluded WGS** (GeneDx Holdings), also live/LONG in the same book (positionId
2308): Polygon classifies it SIC 8000 "SERVICES-HEALTH SERVICES" — a diagnostics/genetic-testing
company monetized by commercial test adoption, not a clinical-stage therapeutics developer with a
binary trial catalyst. This is the same exclusion rationale the `biotech` bucket's own comment
already documents for GRAL (GRAIL) — not folding it in on a symbol-only guess.

**Deliberately did NOT fold SEDG/ENPH into the existing `semis` bucket** despite Polygon filing
both under the identical SIC code (3674) as the semis bucket's own members (NVDA/AMD/...) — their
real risk driver is the residential-solar cycle, not AI-datacenter capex, so merging them into
`semis` would misclassify a different thesis onto an unrelated one. They get their own new `solar`
bucket, same precedent as the existing `corning`/`roblox`/`gamestop`/`sofi` single-pair clusters.

### Blast radius

Both buckets feed the ONE shared `resolveTheme`/`sameThesis` resolver (`theme-cluster.ts`), so the
fix is a single shared-layer change: every consumer (swing gate's `checkPortfolioOverlap`, the
play-brief's `bookContextSection`, and any future PR-6 allocation-cap import per `theme-cluster.ts`'s
own header) benefits identically — no second call site to fix.

### Fix

Extended `biotech` in `src/lib/portfolio/sector-map.ts` with VKTX/SRPT/SMMT/IBRX/CAPR/REPL, and
added a new `solar: ["SEDG", "ENPH"]` bucket. Added regression tests in
`src/lib/swing/theme-cluster.test.ts` asserting `resolveTheme`/`sameThesis` for every added ticker,
the WGS exclusion, and that SEDG/ENPH do not get merged into the unrelated `semis` bucket.
RED→GREEN proven (temporarily reverted `sector-map.ts` alone, confirmed the two new tests fail,
restored the fix, confirmed they pass). `npx tsc --noEmit` clean; full `npm test` run on Node 20.

### Fix rationale

Same discipline as every prior extension in this file: only tickers verified live/concurrently
committed at time of fix are added (no speculative broader baskets), each classification is
Polygon-reference-verified rather than guessed from the symbol, and a name whose risk driver
genuinely differs (WGS) is deliberately left out rather than folded in for convenience.
