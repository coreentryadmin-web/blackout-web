> **kind:** FINDING

## ABVX (clinical-stage biotech) missing from `sectorFor`'s biotech cluster — FIXED

| **Status** | Fixed (`src/lib/portfolio/sector-map.ts`) |
|---|---|

**Found via:** this session's standing Ask Largo deep-dive, as a smaller, independent follow-up discovered while researching the sibling LABD theme-clustering fix (PR #6159).

**Live repro.** `GET /api/market/nighthawk/horizons?view=swings`: ABVX is a real, currently-committed LONG position. `sectorFor`'s `biotech` sector list (`NTLA, CRSP, VIR, MIRM, IONS, NVAX, IOVA, PCVX, TNGX, RLAY`, added 2026-10-10 from a live book snapshot) did not include it — it was simply never live at the time that bucket was built — so ABVX resolved to its own isolated `NAME:ABVX` cluster, and any other biotech position in the same book would get no concentration/conflict flag against it.

**Verification before adding (matching this bucket's own documented discipline of explicit per-ticker verification rather than guessing from the symbol).** Polygon reference (`GET /v3/reference/tickers/ABVX`): Abivax SA, a France-based clinical-stage biotechnology company, single operating segment (R&D), currently in Phase 3 trials for one drug candidate (obefazimod, ulcerative colitis). This is exactly the "binary clinical/regulatory catalyst" risk driver the bucket's own criteria require — the same shape as every other name already in it, not the different-risk-driver shape of the three names the original fix explicitly excluded (RGEN's bioprocessing-tools revenue, GRAL's diagnostics-commercial-adoption catalyst, ABSI's platform-partnership model).

**Fix.** Added `"ABVX"` to the `biotech` array.

**Tests.** Added a regression test (`theme-cluster.test.ts`, the file that already exercises this sector bucket via `resolveTheme`/`sameThesis`): `resolveTheme("ABVX") === "biotech"`, `sameThesis("ABVX", "NTLA") === true`, `sameThesis("ABVX", "IOVA") === true`. RED→GREEN proven via `git stash` (1 failure without the fix, 0 with it restored). Broader regression: `src/lib/swing/*.test.ts` + `src/lib/portfolio/*.test.ts` + `src/features/nighthawk/**/*.test.ts` + `src/lib/zerodte/**/*.test.ts` (this sector map is also read by the 0DTE governor's correlation groups) — 3940/3940 pass. `tsc --noEmit`: clean.
