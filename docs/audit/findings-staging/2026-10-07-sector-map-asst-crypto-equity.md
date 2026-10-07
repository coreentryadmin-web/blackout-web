## `portfolio/sector-map.ts` was missing ASST (Strive bitcoin-treasury), so its SECTOR_ROTATION benchmark and Book-context concentration both mislabeled it as Financials/isolated — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | Ask Largo / Night Hawk Swings — swing play-brief ("Why this setup" industry-leadership read) + portfolio concentration awareness |
| **Severity** | P3 (correctness gap — a real score-pillar input and a real concentration read are both wrong for one name, not a trading-gate defect) |
| **Status** | FIXED |
| **File** | `src/lib/portfolio/sector-map.ts` (`SECTORS.crypto-equity`) |

### Root cause

`industry-group-rs.ts`'s `resolveGroupBenchmark` already has a guard (`NO_SECTOR_BENCHMARK_THEMES`,
added 2026-09-22 for HUT) that returns `null` — no sector-rotation benchmark at all — for any ticker
whose `sectorFor()` label is `"crypto-equity"`, specifically because bitcoin-treasury/mining names get
mechanically bucketed by Polygon's SIC data under a generic finance/holding-company code (e.g. 6199
"FINANCE SERVICES") that lands in `sectorEtfFromSic`'s 6000-6499 Financials range — a real provider
quirk, not evidence the name is a Financials-sector-rotation play. That guard only fires for tickers
`sector-map.ts` actually has in its `crypto-equity` list; an unmapped name falls straight through to the
same SIC-range Financials mislabel the guard exists to prevent.

`ASST` (Strive, Inc. — the former "Asset Entities" shell that converted to a bitcoin-treasury company in
2025, structurally identical to MSTR/Strategy) was not in `SECTORS` at all, so `sectorFor("ASST")`
returned `null` and the guard never engaged. The same unmapped-name gap also means `theme-cluster.ts`'s
`resolveTheme`/`sameThesis` (which feeds `checkPortfolioOverlap`'s Book-context concentration evidence)
clusters ASST into its own isolated `NAME:ASST` cluster instead of with the rest of the crypto-equity
basket (COIN/MARA/RIOT/HUT/MSTR/etc.) it is actually correlated with.

### Evidence

Live audit, 2026-10-07 (pre-market): ASST was live on the Swing WATCH lane (`GET
/api/market/nighthawk/horizons?view=swings`, `lanes.SWING.watch`). Pulled its play-brief
(`GET /api/market/swing/play-brief?playId=SWING:ASST&ticker=ASST&status=COMMIT`) — the "Why this
setup" section's own score-pillar evidence read:

> **Industry read:** leading **Financials** (XLF) by 2.8% over 10 sessions (+1.4% vs -1.4%).

for a company whose live headlines in the same brief are entirely bitcoin-acquisition news ("Strive
Buys 334 Bitcoin...", "Strive Acquires 2K Bitcoin At $84,422 Per Bitcoin..."). Reproduced the mechanism
directly:

```
resolveGroupBenchmark({ ticker: "ASST", sicCode: "6199", sicDescription: "FINANCE SERVICES" })
// before fix: { etf: "XLF", label: "Financials", kind: "sector" }
// after fix:  null
```

Identical mechanism and identical fix shape to the HUT finding this guard was originally built for
(`docs/audit/FINDINGS.md`, 2026-09-22) and the ALAB/CRDO/KLAC and RGTI/QBTS/IONQ/QUBT gaps found the
same way on 2026-09-25 — an unmapped name recreates a bug whose guard already exists, just one tier up.

### Fix

Added `"ASST"` to `SECTORS["crypto-equity"]` in `sector-map.ts`. No other currently-committed/watch
tickers on the live board (checked the full 103-ticker Swing committed+watch list) are obvious
crypto-treasury/mining/exchange names missing from the existing list, so this stays scoped to the one
live-confirmed gap rather than speculatively adding more.

Regression test added (`src/lib/swing/industry-group-rs.test.ts`): confirmed RED before the fix
(`resolveGroupBenchmark({ticker:"ASST", sicCode:"6199"})` returned `{etf:"XLF",...}`) / GREEN after
(returns `null`, both via the SIC path and via a sector-map-label fallback path). `tsc --noEmit` clean;
`industry-group-rs.test.ts` (14/14), `board-allocation.test.ts` + `theme-cluster.test.ts` +
`play-brief-intel.test.ts` (227/227 combined) pass.
