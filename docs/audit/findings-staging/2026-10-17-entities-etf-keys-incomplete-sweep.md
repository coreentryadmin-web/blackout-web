> **kind:** FINDING

## `ETF_KEYS` widening (#6153) was itself an incomplete sweep — ARKG/EWY/KORU/SNDQ still missed — FIXED

| **Status** | Fixed (`src/lib/largo/core/entities.ts`) |
|---|---|

**Found via:** this session's standing Ask Largo deep-dive, a follow-up cycle that deliberately re-checked whether #6153 (merged minutes earlier) actually closed the gap it claimed to.

**Context.** #6153 fixed `composeSwingPlayBrief()`'s hardcoded `ticker_class: "equity"` by deriving it from `canonicalTicker(ticker)?.kind`, and widened `entities.ts`'s `ETF_KEYS` with 8 tickers (`ETHA, ETHU, LABD, NAIL, SOXS, SQQQ, URA, UVIX`) found via a sample of that cycle's own repro. That sample was not exhaustive.

**Live repro.** `GET /api/market/nighthawk/horizons?view=swings` lists all 68 committed/watch swing rows. Checking EVERY ticker against Polygon's own `GET /v3/reference/tickers/<T>` `type` field (not guessed from the name) found 4 more real ETFs the #6153 widening still missed:

| Ticker | Polygon `type` | What it is |
|---|---|---|
| ARKG | ETF | ARK Genomic Revolution ETF |
| EWY | ETF | iShares MSCI South Korea ETF |
| KORU | ETF | Direxion Daily MSCI South Korea Bull 3X ETF |
| SNDQ | ETF | Tradr 2X Short SNDK Daily ETF |

All 4 were real, currently-committed swing positions at the time of the repro, and all 4 returned `ticker_class: "equity"` even after #6153 merged.

**The remaining 60+ tickers in the live book were also checked** (not assumed) — every one returned `CS` (common stock) or, for two foreign names (TSM, ABVX), `ADRC` (ADR — correctly stays "equity", not a fund). No further misses found in this sweep.

**Fix.** Added `ARKG, EWY, KORU, SNDQ` to `ETF_KEYS`.

**Standing caveat, not fixed here.** `ETF_KEYS` is still a finite, hand-maintained set — this is the SECOND time in one session it needed a correction, and it will drift again the next time Banger's whole-market scan picks up a new leveraged/ETN/thematic name no one has enumerated yet. Raised on PR #4076 as an open design question: whether `canonicalTicker`'s `kind` resolution should stay a static set (accepting periodic manual correction, same discipline as today) or grow an optional Polygon-`type`-backed path (self-maintaining, but in tension with `entities.ts`'s own stated "PURE AND TOTAL — no IO" design principle, and with ~15+ existing synchronous call sites). Not unilaterally decided here — this is an architecturally significant call affecting a core shared primitive, not a quick patch.

**Tests.** Added `entities.test.ts`: all 4 newly-added tickers classify as `"etf"`. RED→GREEN proven via `git stash` (1 failure without the fix, 0 with it restored). Broader regression: `src/lib/swing/*.test.ts` + `src/lib/largo/**/*.test.ts` + `src/features/nighthawk/**/*.test.ts` — 4265/4265 pass. `tsc --noEmit`: clean.
