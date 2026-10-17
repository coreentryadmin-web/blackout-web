> **kind:** FINDING

## LABD (3x inverse biotech ETF) was clustered into no theme at all — a real, live LONG LABD + LONG IOVA conflict went unflagged — FIXED

| **Status** | Fixed (`src/lib/swing/theme-cluster.ts`) |
|---|---|

**Found via:** this session's standing Ask Largo deep-dive (5-engine monitor cycle, 2026-10-17 ~23:32 UTC) — a dedicated follow-up investigation on a gap flagged earlier the same session (PR #4076 comment 6242601175, ~22:52 UTC) but deliberately not fixed at the time pending research.

**Live repro.** `GET /api/market/nighthawk/horizons?view=swings` (2026-10-17 ~23:33 UTC): LABD committed twice (LONG, BREAKOUT/STANDARD and BREAKOUT/TACTICAL) and IOVA committed once (LONG) — all three real, currently-open positions in the same book, right now. `theme-cluster.ts`'s `ETF_PROXY_THEMES` had no entry for LABD and `INVERSE_LEVERAGE_ETFS` didn't include it, so `resolveTheme("LABD")` fell through to its own isolated `NAME:LABD` cluster — `sameThesis("LABD", "IOVA")` returned `false`, and a member holding both got **zero** concentration/conflict flag in Book Context, despite LABD (economically a bearish biotech bet, per `effectiveDirection`) directly opposing IOVA's bullish biotech bet.

**Why this wasn't fixed immediately when first found.** The initial finding flagged a real risk: `sectorFor`'s `biotech` sector list (`NTLA, CRSP, VIR, MIRM, IONS, NVAX, IOVA, PCVX, TNGX, RLAY`) names only narrow, individual clinical-stage/gene-therapy names — mapping LABD (a broad index-tracking ETF) into that cluster could have been a mismatched proxy if LABD's real risk driver were a different, larger-cap biotech population than that specific basket.

**Research done before fixing (this cycle), mirroring the rigor the 2026-10-11 SQQQ addition to this same file used:**
- Confirmed via Polygon reference data: LABD = Direxion Daily S&P Biotech Bear 3X ETF, tracking the S&P Biotech **Select Industry Index** — equal-weighted, not cap-weighted.
- Pulled 96 real trading days of daily closes (2026-06-01→2026-10-17) and computed Pearson correlation of daily returns between LABD and: (a) XBI (sanity check, r=−0.999, confirms the data/method), (b) three of `sectorFor`'s own biotech names (NTLA r=−0.615, CRSP r=−0.758, VIR r=−0.712, avg |r|≈0.61), (c) four large-cap diversified healthcare names (UNH, LLY, PFE, JNJ, avg |r|≈0.27).
- The correlation to the narrow clinical-stage basket is **more than double** the correlation to large-cap healthcare — confirming the equal-weighted index is dominated by the same small/mid-cap population `sectorFor` already lists, not a different, larger population. The "mismatched proxy" concern is refuted by measurement, not just argued away.

**Fix.** Added `LABD: "biotech"` to `ETF_PROXY_THEMES` and `"LABD"` to `INVERSE_LEVERAGE_ETFS` — the identical parallel-pair pattern the SOXS and SQQQ fixes already established in this same file.

**Separate, smaller gap found during this research, not fixed here:** `ABVX` (Abivax SA, a clinical-stage biotech per Polygon reference — ulcerative-colitis asset) is also currently committed in the live book and is *not* in `sectorFor`'s biotech list — a second, independent `sector-map.ts` completeness gap, flagged as a candidate follow-up rather than silently expanded into this PR.

**Tests.** Added a regression test mirroring the existing SOXS/SQQQ tests: `ETF_PROXY_THEMES.LABD === "biotech"`, `resolveTheme("LABD") === "biotech"`, `sameThesis("LABD", "IOVA") === true`, `sameThesis("LABD", "NTLA") === true`, `isInverseLeverageEtf("LABD") === true` (case-insensitive), `effectiveDirection("LABD", "LONG") === "SHORT"`. RED→GREEN proven via `git stash` (1 failure without the fix, 0 with it restored). Broader regression: `src/lib/swing/*.test.ts` + `src/lib/portfolio/*.test.ts` — 1846/1846 pass. `tsc --noEmit`: clean.
