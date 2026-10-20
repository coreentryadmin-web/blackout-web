## KGC + AEM (gold-mining producers) were clustered into no theme at all — real, live LONG+LONG concentration went unflagged — FIXED

> **kind:** `FINDING`

| **Status** | Fixed (`src/lib/portfolio/sector-map.ts`) |
|---|---|

**Found via:** the standing Night Hawk Swings "Ask Largo" deep-dive mandate — a fresh `GET
/api/market/swing/play-brief` audit pass across the current committed book, 2026-10-20.

**Live repro.** `GET /api/market/nighthawk/horizons?view=swings`: KGC (positionId 1882) and AEM
(positionId 1846) were both real, currently-committed `LONG` calls (Banger-origin BREAKOUT, same
discovery batch) in the SAME book at the same time. Fetching each ticker's own
`GET /api/market/swing/play-brief` showed neither brief rendered a "Book context" section at all —
`bookContextSection` (`src/lib/swing/play-brief-intel.ts`) returns `null` whenever
`checkPortfolioOverlap` finds no overlap, and it found none here because neither ticker appeared
anywhere in `sector-map.ts`'s `SECTORS` map: both resolved to isolated `NAME:KGC` / `NAME:AEM`
own-clusters (`theme-cluster.ts`'s `resolveTheme` own-cluster fallback), so `sameThesis("KGC",
"AEM")` returned `false` even though both positions are driven by the same underlying commodity
(gold) risk — the identical gap shape as every prior extension to this file (ALAB/CRDO/KLAC,
quantum-computing, biotech, LABD/IOVA): a real, correlated pair live in the book with zero theme
linkage between them.

**Root cause.** `sector-map.ts`'s curated `SECTORS` map is a static, hand-extended list seeded
from whichever tickers happened to be live and committed when each sector bucket was built or
extended. It had no entry for precious-metals/gold-mining names at all — not a misclassification,
an outright absence. Confirmed via Polygon reference (`/v3/reference/tickers/<T>`), not guessed
from the symbol: KGC resolves to "Kinross Gold Corporation" and AEM to "Agnico Eagle Mines Ltd." —
both large-cap gold-mining producers whose equity price is dominated by spot gold price and
mine-level production/cost results, not by any sector already listed in the file.

**Fix.** Added a new `"precious-metals": ["KGC", "AEM"]` entry to `SECTORS`. Deliberately
conservative, same discipline as the crypto-equity/quantum-computing/biotech precedents in this
file: only the two names actually live in the book at time of fix, not a speculative broader
miners basket (e.g. NEM, GOLD) with no live partner to demonstrate against in this snapshot.

**Regression test.** `src/lib/swing/theme-cluster.test.ts` — new test asserts
`resolveTheme("KGC") === "precious-metals"`, `resolveTheme("AEM") === "precious-metals"`,
`sameThesis("KGC", "AEM") === true`, and that neither falsely merges into an unrelated theme
(`sameThesis("KGC", "NVDA") === false`, `sameThesis("AEM", "XOM") === false`). RED proven via
`git stash` on `sector-map.ts` alone (1/27 theme-cluster tests fail — exactly the new assertions,
`resolveTheme("KGC")` returning `"NAME:KGC"` instead of `"precious-metals"`), GREEN after
(27/27). `play-brief-intel.test.ts` + `portfolio.test.ts` (285 tests) pass unchanged; `tsc --noEmit`
clean; `eslint` clean on both touched files.
