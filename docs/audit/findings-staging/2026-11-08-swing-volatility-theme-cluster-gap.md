> **kind:** FINDING

# Swing theme-cluster resolver has no bucket for volatility-tracking ETPs — VXX/UVIX/UVXY/SPXS each false-isolate, hiding a real 4x-stacked risk-off bet

| | |
|---|---|
| **Status** | FIXED |
| **Area** | Swing portfolio-overlap/concentration detector — `src/lib/portfolio/sector-map.ts` (`SECTORS`), consumed by `src/lib/swing/theme-cluster.ts`'s `resolveTheme`/`sameThesis` and `src/lib/swing/portfolio.ts`'s `checkPortfolioOverlap` |
| **Severity** | P2 — real, currently-committed concentration invisible to the trader-facing Book-context signal |

## Root cause

`resolveTheme()` (`theme-cluster.ts`) partitions tickers into shared "theme" clusters so
`checkPortfolioOverlap` can flag concentration/conflict across different symbols expressing the
same underlying bet. Resolution falls through, in order: `ETF_PROXY_THEMES` override → governor's
broad-market index/ETF complex → `sectorFor` (`portfolio/sector-map.ts`'s `SECTORS` map) → an
isolated own-cluster (`NAME:<ticker>`) when nothing else matches.

No entry for VXX, UVIX, UVXY or SPXS existed anywhere in `ETF_PROXY_THEMES` or `SECTORS` — a
`grep -n "VXX\|UVIX\|UVXY\|SPXS" src/lib/portfolio/sector-map.ts src/lib/swing/theme-cluster.ts`
returned nothing before this fix. Each ticker therefore fell through to its own isolated
`NAME:<ticker>` cluster, so `sameThesis` never saw any two of them as related and
`checkPortfolioOverlap` reported `hasOverlap:false` no matter how many of them the book held
concurrently.

This is the FIFTH live instance of this exact gap shape in this file (after SOXS/SQQQ/LABD in
`ETF_PROXY_THEMES`, and ALAB/CRDO/KLAC/SMCX/MULL/AVGX/MTSI/CRWV/NBIS/DRAM and the
precious-metals/solar/agricultural-chemicals/defense-space-systems buckets in `SECTORS`) — a
recurring class of bug (a liquid, options-active name with a real correlated peer group simply
has no entry yet), not a one-off.

## Evidence

Live production repro, `GET /api/market/nighthawk/horizons?view=swings`, 2026-11-08: the real
committed swing book holds VXX LONG (positionId 2479), UVIX LONG, UVXY LONG and SPXS LONG
simultaneously — functionally ONE "long volatility / risk-off" bet stacked four times. Confirmed
directly in-process before the fix:

```
resolveTheme("VXX")  -> "NAME:VXX"
resolveTheme("UVIX") -> "NAME:UVIX"
resolveTheme("UVXY") -> "NAME:UVXY"
sameThesis("VXX","UVIX") -> false
checkPortfolioOverlap({ticker:"VXX",direction:"LONG"},
  [{ticker:"UVIX",direction:"LONG"},{ticker:"UVXY",direction:"LONG"},{ticker:"SPXS",direction:"LONG"}])
  -> hasOverlap:false
```

VXX's own live `GET /api/market/swing/play-brief` response (via `scripts/audit/lib/audit-auth-
fetch.mjs`'s `fetchAuditJson`) carried no "Book context" section at all for this real, four-deep
concentration.

**Correlation measured, not guessed** — same evidence bar as this file's own LABD precedent
(96 real trading days, pairwise r, avg-|r| comparison vs the next-best alternative bucket). Real
Polygon daily bars, 151 trading days (2026-04-02 .. 2026-11-08), Pearson r of daily returns:

| Pair | r | n |
|---|---|---|
| VXX vs UVIX | 0.9969 | 151 |
| VXX vs UVXY | 0.9969 | 151 |
| UVIX vs UVXY | 0.9978 | 151 |
| VXX vs SPXS | 0.8047 | 151 |
| UVIX vs SPXS | 0.8047 | 151 |
| UVXY vs SPXS | 0.8029 | 151 |

VXX/UVIX/UVXY pairwise r > 0.99 — expected, since UVIX/UVXY are 1.5-2x-levered VIX-futures funds
tracking the exact same short-term VIX-futures complex VXX tracks directly (the same relationship
SOXL/SOXS or TQQQ/SQQQ already have within the `semis` bucket). SPXS (Direxion Daily S&P 500 Bear
3x — a 3x INVERSE equity-index fund, a different primal driver than VIX term structure) was
measured rather than assumed either way: r=0.803-0.805 against each of VXX/UVIX/UVXY, more than
double the LABD precedent's ~0.61 avg bar for inclusion — confirming "equities crash" and "vol
spikes" are the same real risk event, so SPXS belongs in the SAME bucket.

Two real candidates were ALSO found unmapped in the same live book and deliberately measured
rather than folded in on a symbol-only guess, per this file's own "never a false merge"
discipline:

| Pair | r | n |
|---|---|---|
| VXX vs NUGT (3x gold miners) | -0.3917 | 151 |
| SPXS vs NUGT | -0.5214 | 151 |
| VXX vs SCO (2x inverse crude) | -0.2441 | 151 |
| SPXS vs SCO | -0.3706 | 151 |
| NUGT vs SCO | 0.3797 | 151 |

Both weak/inconsistent-sign — confirming gold-miner and crude-oil exposure are genuinely different
risk drivers from equity-index/volatility stress, not this bucket's thesis. Left unmapped (their
own `NAME:` cluster) rather than joining the new bucket.

Ticker identity for all four added names independently confirmed via Polygon reference
(`/v3/reference/tickers/<T>`), not guessed from the symbol: VXX "iPath Series B S&P 500 VIX
Short-Term Futures ETN", UVIX "2x Long VIX Futures ETF", UVXY "ProShares Ultra VIX Short-Term
Futures ETF", SPXS "Direxion Daily S&P 500 Bear 3x ETF".

**RED → GREEN** (`git stash` the `sector-map.ts` change only, keep the new tests):
- RED: `npx tsx --experimental-test-module-mocks --test src/lib/swing/theme-cluster.test.ts
  src/lib/swing/portfolio.test.ts` → 51 pass / **2 fail** (`resolveTheme("VXX") !== "volatility"`;
  live-scenario `checkPortfolioOverlap` test expects 3 same-direction overlaps, got 0).
- GREEN (fix restored): 53 pass / 0 fail. `npx tsc --noEmit` clean.

## Blast radius

- `src/lib/swing/theme-cluster.ts`'s `resolveTheme`/`sameThesis` — the one resolver both the swing
  gate's overlap flag and `checkPortfolioOverlap` read; fixed at the shared `sectorFor` layer so
  every caller benefits, not a swing-local patch.
- `src/lib/swing/portfolio.ts`'s `checkPortfolioOverlap` / `bookContextSection`
  (`play-brief-intel.ts`) — the trader-facing "Book context" concentration narrative for any of
  these four tickers now renders real cross-ticker concentration instead of silence.
- `src/lib/portfolio/cross-desk-theme.ts` and `src/lib/portfolio/board-allocation.ts` both import
  the SAME `sectorFor` from `portfolio/sector-map.ts` (per `theme-cluster.ts`'s own header comment:
  "Cross-desk combined exposure (Q25) uses `portfolio/cross-desk-theme.ts` (`sectorFor`
  canonical)") — both pick up the new `volatility` bucket automatically, a positive side-effect,
  not a change either file needed to make itself.
- No `effectiveDirection`/`INVERSE_LEVERAGE_ETFS` entry needed for any of the four: unlike SOXS (a
  -3x fund sharing a bucket with its own +3x bullish sibling SOXL, where a LONG position on either
  is the OPPOSITE economic bet), none of VXX/UVIX/UVXY/SPXS has an opposite-leverage sibling
  inside this bucket — a LONG position in any of them is already the same real-world "risk-off"
  bet, so the raw `direction` field compares correctly with no adjustment. Confirmed in the new
  tests (`isInverseLeverageEtf("VXX") === false`, etc).
- A separate, unrelated `src/lib/sector-map.ts` (GICS-style flow-aggregation sector map consumed
  by `industry-group-rs.ts`/`swing-ingest.ts`/`nighthawk/cortex/fetch.ts`) already tags VXX/UVXY
  as `"Indices"` for a different purpose (relative-strength benchmarking) — out of scope for this
  fix, which is specifically the swing concentration/overlap detector's theme partition.

## Fix rationale

Added a new `volatility: ["VXX", "UVIX", "UVXY", "SPXS"]` entry to `SECTORS`
(`portfolio/sector-map.ts`), not `ETF_PROXY_THEMES` (`theme-cluster.ts`) — following the file's own
established convention: `ETF_PROXY_THEMES` is for an ETF whose nominal label points at an EXISTING
sector it should instead override into (QQQ's index label → the already-existing `semis` bucket);
there is no pre-existing "volatility" sector to override into here, so this is a brand-new named
cluster, the same shape as the solar/corning/roblox/precious-metals/agricultural-chemicals/
defense-space-systems single-purpose buckets already in `SECTORS`. Deliberately left NUGT and SCO
out despite being found unmapped in the same live book — their measured correlation does not
clear the bar, and folding them in on a looser "all leveraged/inverse ETFs must correlate"
assumption would be exactly the false-merge this file's header explicitly warns against.
