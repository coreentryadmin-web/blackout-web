## Book concentration (`checkPortfolioOverlap`) undercounting real crypto-correlated exposure — theme map missing exchanges, miners, and BTC/ETH trust/ETF wrappers

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Status** | FIXED |
| **Area** | `src/lib/portfolio/sector-map.ts` (`SECTORS["crypto-equity"]`) |

### How found

Live WATCH/OPEN thesis forensics this cycle (Ask Largo × Night Hawk Swings standing mandate). While
investigating a separate, ultimately-non-issue "Thesis health" finding on a 2026-09-18 Banger-promoted
commit batch (36 positions, all crypto-price-correlated names — miners, exchanges, ETH/BTC trust
wrappers), noticed the batch's own live "Book overlap" evidence line (`play-brief.ts`, backed by
`checkPortfolioOverlap`/`theme-cluster.ts`'s `resolveTheme`) reported only **11 same-direction
positions in theme "crypto-equity"** — a fraction of the real ~25+ crypto-correlated names actually
live in the book at the time.

### Root cause

`sector-map.ts`'s `SECTORS["crypto-equity"]` is a curated, hand-maintained static list (the file's own
header: *"Extend as new names show up on the board"* — the same process a prior live finding, cited in
this file's own comments, already used once for `MSTU`/`MSTX`/`GLXY`/`SBET`). It had never been
extended to cover:
- **Crypto exchanges/custodians**: GEMI (Gemini Space Station), BKKT (Bakkt), ABTC (American Bitcoin
  Corp), BLSH (Bullish) — same risk bucket as the already-listed COIN.
- **Bitcoin miners**: BMNR (Bitmine Immersion), BTDR (Bitdeer) — same risk bucket as the already-listed
  MARA/RIOT/CLSK/HUT/IREN.
- **Direct BTC/ETH trust/ETF wrappers**: ETH, ETHE, ETHU, ETHA (Ethereum) and IBIT, GBTC, BITO, BITX
  (Bitcoin) — not equities, but an even more direct crypto-price read than the mining/holding equities
  already in the bucket, so they belong in the same concentration cluster rather than each getting its
  own isolated (and therefore invisible-to-concentration) cluster.

Every one of these 14 tickers was a real, live, committed swing position on the board at the time of
this finding — not a hypothetical gap.

**Deliberately conservative, not exhaustive**: left out names with only partial/ambiguous crypto
correlation this pass — HOOD (Robinhood, meaningful crypto revenue but also a broad retail brokerage),
CRCL (Circle, a stablecoin issuer — arguably belongs but debatable), APLD (Applied Digital, historically
bitcoin-mining-hosting but increasingly an AI-datacenter company), BULL (Webull, supports crypto trading
but is a general brokerage). Extending the map further to cover those is a legitimate follow-up, not
bundled into this fix to keep the change unambiguous.

### Fix

Added the 14 tickers above to `SECTORS["crypto-equity"]` in `sector-map.ts`, following the exact
established pattern/precedent already in the file (the MSTU/MSTX/GLXY/SBET addition, same comment
style, same array). No logic changed — `resolveTheme`/`sameThesis`/`checkPortfolioOverlap` are
untouched; this is purely additive data.

### Blast radius

`sector-map.ts`'s `sectorFor()` feeds `theme-cluster.ts`'s `resolveTheme()`/`sameThesis()`, which is the
**single, shared** theme resolver for both the swing entry gate's overlap evidence (`portfolio.ts`'s
`checkPortfolioOverlap`, surfaced in `play-brief.ts`'s "Book overlap" evidence line and
`play-brief-diff.ts`'s book-context narrative) and the future allocation-cap engine (per the module's
own header). Every consumer of `sameThesis`/`resolveTheme` benefits from the corrected clustering —
concentration counts for any of these 14 tickers will now correctly include their real crypto-correlated
peers.

### Verification

New regression test in `theme-cluster.test.ts`, following the exact style of the existing
MSTU/MSTX/GLXY/SBET test: asserts `resolveTheme` for all 14 new tickers and `sameThesis` across a
representative cross-section (exchange vs equity, miner vs equity, ETF wrapper vs equity). RED→GREEN
proven via `git stash` on `sector-map.ts` alone (test file kept): 1 failure without the fix, 0 with it
(12/12 in `theme-cluster.test.ts`). `npx tsc --noEmit`: clean. `portfolio.test.ts` (the direct consumer
of theme resolution for concentration) re-run clean, 11/11, no regression. Full `npm test` (Node 20) run
before opening the PR.

Per CLAUDE.md's rescinded Cursor-sign-off carve-out (2026-09-10): merges on green CI + clean mergeable
state, no Cursor review wait required.
