> **kind:** FINDING

## Portfolio/theme concentration detection was blind to same-underlying leveraged-ETF and crypto-token-wrapper duplication — FIXED

| **Status** | FIXED (this commit) |
|---|---|

**What was missing:** `sectorFor` (`src/lib/portfolio/sector-map.ts`) and `resolveTheme`/`ETF_PROXY_THEMES`
(`src/lib/swing/theme-cluster.ts`) are the shared theme resolvers `checkPortfolioOverlap`/`sameThesis` use to
flag concentration risk ("NVDA + AMD + SMH + QQQ is one 4x semis bet, not four independent edges"). Several
real tickers that are economically duplicative of an existing cluster member were absent from every map, so
each resolved to its own isolated `NAME:<ticker>` cluster and could never trip a concentration flag against
the position it actually duplicates:

- `MSTU`/`MSTX` — leveraged single-stock ETFs tracking `MSTR` itself (already in `crypto-equity`) — absent.
- `GLXY` (Galaxy Digital) — a crypto-holdings proxy, same risk bucket as `COIN`/`MARA`/`MSTR` — absent.
- `XRP`/`XRPZ`/`XXRP` — three separate wrapper tickers on the same underlying token — absent from every map.

**Evidence (live, raised on PR #4076 forensic batches 10-12, 2026-09-14, root-caused and its fix shape agreed
there before implementing):** the book held, at various points, `MSTU` + `MSTX` simultaneously (both LONG
calls, same underlying bet) and a live 6-way instance — `XRP`, `XRPZ`, `XXRP`, `GLXY`, `MSTU`, `MSTX` — all
same-direction LONG, all real overlapping crypto exposure, with zero Book Context concentration flag between
any pair. `MSTX`'s own play-brief had no Book Context section at all.

**What changed:**
- Added `MSTU`, `MSTX`, `GLXY` to `sector-map.ts`'s `crypto-equity` list (same bucket as `COIN`/`MARA`/`MSTR`).
- Added `XRP`, `XRPZ`, `XXRP` to `theme-cluster.ts`'s `ETF_PROXY_THEMES`, mapped to a new `"crypto-xrp"` key —
  deliberately its OWN cluster, not folded into `crypto-equity`, since a token's own price is a different risk
  driver than mining/holding-company equity beta (COIN/MSTR do not move 1:1 with XRP's own price).

**Fix rationale:** purely additive data-config change to two curated static maps — no engine, gate, or
overlap-detection LOGIC touched (the overlap code itself was confirmed correct on PR #4076 before this
shipped; it just had nowhere to resolve these tickers to a shared cluster). Zero risk to any existing mapped
ticker's resolution.

**Test:** RED→GREEN proven (git-stashed both source files, confirmed 3 new regression tests fail with the
exact live-finding tickers, all pass after restoring the fix). Full `src/lib/swing/*.test.ts` +
`src/lib/portfolio/*.test.ts` (1179 tests, +3) green, `tsc --noEmit` clean.
