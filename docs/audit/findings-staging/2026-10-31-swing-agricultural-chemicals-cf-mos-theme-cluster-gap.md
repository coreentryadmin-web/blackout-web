> **kind:** FINDING

## Night Hawk Swings — agricultural-chemicals theme-cluster gap (CF Industries / Mosaic) — FIXED

**Status:** FIXED (`fix/sector-map-agricultural-chemicals-cf-mos`)

Standing Ask Largo × Night Hawk Swings ownership mandate live sweep (`CLAUDE.md`), same gap shape
as every prior `sector-map.ts` extension (ALAB/CRDO/KLAC, quantum-computing, biotech,
precious-metals, cybersecurity/software, biotech/solar). Not a duplicate of the already-fixed
2026-10-31 biotech/solar staged finding (`2026-10-31-swing-biotech-solar-theme-cluster-gap.md`),
which covers VKTX/SRPT/SMMT/IBRX/CAPR/REPL and SEDG/ENPH only.

### Root cause

`checkPortfolioOverlap` (portfolio.ts) clusters book positions by `(resolveTheme(ticker),
direction)` to flag same-thesis concentration in each play-brief's "Book context" section.
`resolveTheme` falls through to `sectorFor` (`src/lib/portfolio/sector-map.ts`), a curated static
ticker→sector map; an unmapped ticker resolves to its own isolated `NAME:<ticker>` cluster and can
never be flagged as sharing a thesis with anything else.

Live-queried the real committed Swing book (`GET /api/market/nighthawk/horizons?view=swings`,
`board.lanes.SWING.committed`) and confirmed CF (CF Industries, positionId 2319, LONG, archetype
BREAKOUT, contract `O:CF261106C00130000`) and MOS (The Mosaic Company, positionId 2198, LONG,
archetype BREAKOUT, contract `O:MOS261106C00019500`) were both concurrently LONG/COMMIT. Neither
ticker (nor PPG or IP, checked for completeness) appeared anywhere in `SECTORS`
(`grep -n '"CC"\|"CF"\|"MOS"\|"PPG"\|"IP"\b' src/lib/portfolio/sector-map.ts` → no output), so
`sectorFor("CF")`/`sectorFor("MOS")` both returned `null` and each resolved to its own isolated
`NAME:<ticker>` cluster — the real 2-name fertilizer/ag-input-price concentration was invisible to
`checkPortfolioOverlap` and both positions' "Book context" sections were silently omitted.

### Evidence

Polygon reference lookup (`/v3/reference/tickers/<T>`), not guessed from the symbol:

| Ticker | SIC | SIC description | Bucket |
|---|---|---|---|
| CF  | 2870 | AGRICULTURAL CHEMICALS | agricultural-chemicals |
| MOS | 2870 | AGRICULTURAL CHEMICALS | agricultural-chemicals |

Both carry the identical 4-digit SIC code — the exact bar every prior extension in this file uses
(e.g. the precious-metals KGC/AEM pair, the ALAB/CRDO/KLAC semis extension). CF (CF Industries) and
MOS (The Mosaic Company) are large-cap nitrogen/phosphate fertilizer producers whose equity is
dominated by the same ag-input commodity-price cycle (crop prices, natural-gas feedstock costs,
global fertilizer demand) — not by any sector already listed (`energy`, `financials`, `consumer`).

Live play-brief fetch (`GET /api/market/swing/play-brief`) for both positions confirmed the gap at
the UI-adjacent layer: CF (`SWING:CF:2319`, OPEN) and MOS (`SWING:MOS:2198`, OPEN) both have a
byte-identical section-title set with **no "Book context" entry** — [Verdict, Management, Thesis
health, Position, Trade manager read, Why this setup, Chart technicals, Catalysts & news, Meridian
catalysts, Earnings peer lens, Data freshness, What to watch].

Checked `docs/audit/FINDINGS.md` and `docs/audit/findings-staging/*.md` for `CF`/`MOS`/
`agricultural`/`AGRICULTURAL CHEMICALS` — no existing entry covers this pair.

### Blast radius

Feeds the ONE shared `resolveTheme`/`sameThesis` resolver (`theme-cluster.ts`), so the fix is a
single shared-layer change: every consumer (swing gate's `checkPortfolioOverlap`, the play-brief's
`bookContextSection`, and any future PR-6 allocation-cap import per `theme-cluster.ts`'s own
header) benefits identically — no second call site to fix.

### Fix

Added a new `"agricultural-chemicals": ["CF", "MOS"]` bucket to `SECTORS` in
`src/lib/portfolio/sector-map.ts` — no existing themed peer for either ticker, same precedent as
the existing `corning`/`roblox`/`gamestop`/`sofi`/`solar`/`precious-metals` single-pair clusters
(a leveraged-wrapper-free pair gets its own small bucket rather than being folded into an unrelated
one). Added a regression test in `src/lib/swing/theme-cluster.test.ts` asserting
`resolveTheme("CF")`/`resolveTheme("MOS")` both resolve to `"agricultural-chemicals"`,
`sameThesis("CF", "MOS") === true`, and that neither is falsely merged into an unrelated bucket
(`XOM`/`NVDA`). RED→GREEN proven: added the test first against unmodified `main` (failed —
`resolveTheme("CF")` returned `"NAME:CF"` instead of `"agricultural-chemicals"`), then applied the
`sector-map.ts` fix and confirmed the same test passes. `npx tsc --noEmit` clean (Node 20); full
relevant test run (`theme-cluster.test.ts` + `allocation.test.ts` + `cross-desk-theme.test.ts` +
`board-allocation.test.ts` + `swing-portfolio-budget.test.ts` + `portfolio.test.ts`) — 93/93 pass.

### Fix rationale

Same discipline as every prior extension in this file: only the two tickers verified live/
concurrently committed at time of fix are added (no speculative broader basket, e.g. no PPG/IP
despite both plausibly touching chemicals), the classification is Polygon-reference-verified
rather than guessed from the symbol, and the new bucket is deliberately NOT merged into any
existing sector (not `energy`, not `financials`) since the ag-input commodity-price driver is
genuinely distinct from every bucket already present.
