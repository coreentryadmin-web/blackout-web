> **kind:** FINDING

## Night Hawk Swings — defense/space-systems theme-cluster gap (Kratos Defense / Redwire) — FIXED

**Status:** FIXED (`fix/sector-map-defense-space-systems-ktos-rdw`)

Standing Ask Largo × Night Hawk Swings ownership mandate live sweep (`CLAUDE.md`), same gap shape
as every prior `sector-map.ts` extension (ALAB/CRDO/KLAC, quantum-computing, biotech,
precious-metals, solar, agricultural-chemicals). Checked `docs/audit/FINDINGS.md`, every
`docs/audit/findings-staging/*.md` and `git log` for `KTOS`/`RDW`/`Kratos`/`Redwire` before
starting — no existing fix, staged finding, or PR covers this ticker pair.

### Root cause

`checkPortfolioOverlap` (`src/lib/swing/portfolio.ts`) clusters book positions by
`(resolveTheme(ticker), direction)` to flag same-thesis concentration in each play-brief's "Book
context" section. `resolveTheme` (`src/lib/swing/theme-cluster.ts`) falls through to `sectorFor`
(`src/lib/portfolio/sector-map.ts`), a curated static ticker→sector map; an unmapped ticker
resolves to its own isolated `NAME:<ticker>` cluster and can never be flagged as sharing a thesis
with anything else.

Confirmed against current `main` (not trusted from the task description): `grep -ni
'defense|aerospace|military|missile'` and `grep -n '"KTOS"\|"RDW"'` against
`src/lib/portfolio/sector-map.ts` both return nothing — neither ticker, nor any defense/aerospace
bucket, exists anywhere in the file. Reproduced the resolver output directly (real
`resolveTheme`/`sameThesis`, not a mock): `resolveTheme("KTOS") === "NAME:KTOS"`,
`resolveTheme("RDW") === "NAME:RDW"`, `sameThesis("KTOS", "RDW") === false` — confirmed via the
new regression test's RED run (below), which fails on unmodified `main` with exactly this
mismatch.

KTOS (Kratos Defense & Security Solutions) and RDW (Redwire Corporation) were both reported live,
concurrently LONG/COMMIT in the Swing book (`GET /api/market/nighthawk/horizons?view=swings`,
`board.lanes.SWING.committed`, positionId 2291 and 2209 respectively, both archetype BREAKOUT) —
the real same-direction small-cap defense/space concentration was invisible to
`checkPortfolioOverlap` and both positions' live play-briefs rendered no "Book context" section at
all.

### Evidence

Polygon reference lookup (`/v3/reference/tickers/<T>`), not guessed from the symbol:

| Ticker | SIC | SIC description | Bucket |
|---|---|---|---|
| KTOS | 3760 | GUIDED MISSILES & SPACE VEHICLES & PARTS | defense-space-systems |
| RDW  | 3760 | GUIDED MISSILES & SPACE VEHICLES & PARTS | defense-space-systems |

Both carry the identical 4-digit SIC code — the exact bar every prior extension in this file uses
(e.g. the precious-metals KGC/AEM pair, the agricultural-chemicals CF/MOS pair merged earlier the
same day in PR #7020). KTOS and RDW are small-cap tactical-systems/space-component makers whose
equity is dominated by the same defense-budget/launch-cadence risk driver — not by any sector
already listed (`semis`, `ai-power`, etc.).

Two adjacent candidates were deliberately checked and excluded rather than folded in on a loose
match, per this file's own "never falsely merge" header discipline:
- **LHX** (L3Harris, also live LONG/COMMIT in the same book) carries SIC 3812 "SEARCH, DETECTION,
  NAVIGATION, GUIDANCE, AERONAUTICAL SYS" — adjacent but NOT the same SIC as KTOS/RDW's 3760, and
  is a $50B+ prime contractor, a materially different risk profile from KTOS/RDW's small-cap
  tactical/space-component makers.
- **NN** (NextNav Inc., also live LONG/COMMIT in the same book) happens to share LHX's exact SIC
  3812 purely by generic-code coincidence — it is a spectrum-based 3D-geolocation/positioning-tech
  company (confirmed via Polygon ticker name lookup, not guessed from the symbol) with no real
  defense-prime business overlap with L3Harris at all.

Folding either LHX or NN in on SIC proximity alone would be exactly the false-merge this file's own
header warns against ("an unmapped name is NEVER falsely merged into a shared thesis"), so the new
bucket holds only the two names that are both live and genuinely SIC-matched (KTOS/RDW), not a
broader "defense" bucket.

Live play-brief fetch (`GET /api/market/swing/play-brief`) for both positions confirmed the gap at
the UI-adjacent layer: KTOS (`SWING:KTOS`, positionId 2291, COMMIT) and RDW (`SWING:RDW`,
positionId 2209, COMMIT) both returned HTTP 200 with no "Book context" entry in `envelope.sections`
— KTOS: [Verdict, Management, Thesis health, Position, Trade manager read, Why this setup, Chart
technicals, Catalysts & news, Meridian catalysts, Earnings peer lens, Data freshness, What to
watch]; RDW: the identical shape minus the duplicate "Chart technicals" entry. As a positive
control proving the mechanism itself works correctly once a map entry exists: CF's play-brief
(positionId 2319, fixed earlier the same day in PR #7020) DOES render a "Book context" section
reading "Concentration — already holding 1 same-direction position in theme
'agricultural-chemicals': MOS LONG...".

### Blast radius

Feeds the ONE shared `resolveTheme`/`sameThesis` resolver (`theme-cluster.ts`), so the fix is a
single shared-layer change: every consumer (swing gate's `checkPortfolioOverlap`, the play-brief's
`bookContextSection` in `play-brief-intel.ts`, and any future PR-6 allocation-cap import per
`theme-cluster.ts`'s own header) benefits identically — no second call site to fix.

### Fix

Added a new `"defense-space-systems": ["KTOS", "RDW"]` bucket to `SECTORS` in
`src/lib/portfolio/sector-map.ts` — deliberately narrow (only the two SIC-matched, live-committed
names), same precedent as the existing `corning`/`roblox`/`gamestop`/`sofi`/`solar`/
`agricultural-chemicals`/`precious-metals` single-pair clusters. LHX and NN are intentionally left
unmapped (own `NAME:` clusters), per the exclusion rationale above.

Added a regression test in `src/lib/swing/theme-cluster.test.ts` asserting
`resolveTheme("KTOS")`/`resolveTheme("RDW")` both resolve to `"defense-space-systems"`,
`sameThesis("KTOS", "RDW") === true`, that neither is falsely merged into an unrelated bucket
(`NVDA`/`XOM`), and that LHX/NN stay excluded (`sameThesis("KTOS","LHX") === false`,
`sameThesis("RDW","NN") === false`, both still resolving to their own `NAME:<ticker>` clusters).

RED→GREEN proven: added the test first against the unmodified `sector-map.ts` (no code edit) —
failed with `AssertionError: expected 'defense-space-systems', actual 'NAME:KTOS'` on the
`resolveTheme("KTOS")` assertion. Then applied the `sector-map.ts` fix and re-ran the identical
test file — all 33 tests pass, including the new one. Restored the fix via the saved file (the
change was applied with `Edit`, not `git stash`, per this sandbox's shared-stash-stack warning).

`npx tsc --noEmit` clean (Node 20, `/opt/node20/bin`). Full relevant test run (`theme-cluster.test.ts`
+ `portfolio.test.ts` + `play-brief-intel.test.ts`) — 395/395 pass.

### Fix rationale

Same discipline as every prior extension in this file: only the two tickers verified live/
concurrently committed at time of fix are added (no speculative broader "defense" basket), the
classification is Polygon-reference-verified rather than guessed from the symbol, and two
plausible-looking SIC-adjacent candidates (LHX, NN) were explicitly evaluated and deliberately left
OUT rather than folded in on a looser match — the exact discipline this file's own header exists to
enforce.
