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
- `GLXY` (Galaxy Digital), `SBET` (crypto-treasury) — crypto-holdings proxies, same bucket as `COIN`/`MARA`/`MSTR` — absent.
- `XRP`/`XRPZ`/`XXRP` — three separate wrapper tickers on the same underlying token — absent from every map.
- `RBLU`/`GMEU`/`SOFX` — leveraged single-stock ETFs on `RBLX`/`GME`/`SOFI`, none of which had an existing
  themed cluster of their own — absent, and so were their underlyings.
- `PLTU` — leveraged single-stock ETF on `PLTR`, which WAS already mapped (`software`) — the wrapper was missing.

**Evidence (live, raised on PR #4076 forensic batches 10-12/23/26, 2026-09-14/15, root-caused and its fix
shape agreed there before implementing):** the book held, at various points, `MSTU` + `MSTX` simultaneously
(both LONG calls, same underlying bet) and a live 6-way instance — `XRP`, `XRPZ`, `XXRP`, `GLXY`, `MSTU`,
`MSTX` — all same-direction LONG, all real overlapping crypto exposure, with zero Book Context concentration
flag between any pair. `MSTX`'s own play-brief had no Book Context section at all. Batch 26 separately found
`RBLU`/`GMEU`/`SOFX`/`PLTU` simultaneously committed in the same 85-row book, confirming this is a general
pattern across any single-stock leveraged-ETF issuer (T-REX, Defiance, Tradr, etc.), not limited to crypto.

**What changed:**
- Added `MSTU`, `MSTX`, `GLXY`, `SBET` to `sector-map.ts`'s `crypto-equity` list (same bucket as `COIN`/`MARA`/`MSTR`).
- Added `PLTU` to `sector-map.ts`'s existing `software` list (alongside `PLTR`).
- Added three new small paired sectors — `roblox` (`RBLX`/`RBLU`), `gamestop` (`GME`/`GMEU`), `sofi`
  (`SOFI`/`SOFX`) — each its OWN cluster, since these are unrelated companies that must never be merged with
  each other, only with their own leveraged wrapper.
- Added `XRP`, `XRPZ`, `XXRP` to `theme-cluster.ts`'s `ETF_PROXY_THEMES`, mapped to a new `"crypto-xrp"` key —
  deliberately its OWN cluster, not folded into `crypto-equity`, since a token's own price is a different risk
  driver than mining/holding-company equity beta (COIN/MSTR do not move 1:1 with XRP's own price).

**Fix rationale:** purely additive data-config change to two curated static maps — no engine, gate, or
overlap-detection LOGIC touched (the overlap code itself was confirmed correct on PR #4076 before this
shipped; it just had nowhere to resolve these tickers to a shared cluster). Zero risk to any existing mapped
ticker's resolution. Deliberately did NOT extend into the broader, still-speculative clusters raised alongside
these (solar SEDG/ENPH, cybersecurity HACK/BUG) — those were flagged as "plausible," not live-corroborated the
way every ticker in this fix was, so they stay open on #4076 pending further evidence or a broader design call.

**Test:** RED→GREEN proven (git-stashed both source files, confirmed regression tests fail with the exact
live-finding tickers, all pass after restoring the fix). Full `src/lib/swing/*.test.ts` +
`src/lib/portfolio/*.test.ts` (1181 tests, +5 vs. baseline) green, `tsc --noEmit` clean.
