## TSLA + TSLL (plain stock vs its own 2x-leveraged wrapper) were clustered into no theme at all — real, live LONG+LONG concentration went unflagged — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | Fixed (`src/lib/portfolio/sector-map.ts`) |
| **Found via** | Ask Largo standing audit mandate (Night Hawk Swings lane), live WATCH/COMMIT book sweep |

### Live repro

A real committed book held **TSLA LONG** and **TSLL LONG** concurrently — TSLL is "Direxion Daily
TSLA Bull 2X ETF" (confirmed via Polygon reference, not guessed from the symbol: `name: "Direxion
Shares ETF Trust Direxion Daily TSLA Bull 2X ETF"`), i.e. the literal same underlying stock, just a
2x-leveraged wrapper on it. Neither `ETF_PROXY_THEMES` nor `sector-map.ts`'s `SECTORS` map had an
entry for TSLL, so it resolved to an isolated `NAME:TSLL` own-cluster — `checkPortfolioOverlap`
never saw the TSLA/TSLL pair as the same thesis, and neither play-brief ever rendered a "Book
context" concentration flag for a book that was, in substance, holding roughly 3x effective
exposure to one stock.

### Root cause

Same gap shape as every other extension in this file (SMCX/MULL/AVGX→semis, AMZU→megatech,
PLTU→software, GLW/GLWG→corning, KGC/AEM→precious-metals): a single-stock leveraged ETF simply had
no entry anywhere `resolveTheme` (`theme-cluster.ts`) checks, so it fell through to its own isolated
`NAME:` cluster instead of joining its underlying's existing theme bucket.

### Fix

Added `"TSLL"` to the existing `"ev-auto": ["TSLA", "RIVN", "LCID", "F", "GM"]` entry in
`sector-map.ts` — TSLA already has a peer bucket here, so TSLL joins it directly (same convention
as SMCX/MULL/AVGX joining the existing "semis" bucket), no new single-pair bucket needed (unlike
GLW/GLWG, which had no existing bucket to join).

### Blast radius

Single entry, single file. `resolveTheme`/`sameThesis` (`theme-cluster.ts`) automatically pick up
the new mapping via the existing `sectorFor` fallthrough — no change needed there.

### Regression test

Added to `src/lib/swing/theme-cluster.test.ts`: TSLA and TSLL resolve to the same `"ev-auto"`
theme, `sameThesis("TSLA","TSLL") === true`, TSLL joins the WHOLE ev-auto cluster (not just TSLA —
`sameThesis("TSLL","RIVN") === true`), and neither falsely merges into an unrelated theme
(`sameThesis("TSLL","NVDA") === false`).

RED→GREEN proven via `git stash` isolation on `sector-map.ts` alone. Sibling suites
`theme-cluster.test.ts` (28/28), `portfolio.test.ts` (287/287 — unaffected), `play-brief-intel.test.ts`
(unaffected). Full `npm test` on Node 20: 16386 pass / 0 fail / 3 skipped. `tsc --noEmit`: clean.
