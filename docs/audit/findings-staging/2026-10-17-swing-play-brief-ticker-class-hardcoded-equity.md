> **kind:** FINDING

## Night Hawk Swings play-brief hardcodes `ticker_class: "equity"` for every ticker, including live ETF positions — violates Largo contract C4 — FIXED

| **Status** | Fixed (`composeSwingPlayBrief()`, `src/lib/swing/play-brief.ts`; `canonicalTicker`'s `ETF_KEYS`, `src/lib/largo/core/entities.ts`) |
|---|---|

**Found via:** this session's standing Ask Largo deep-dive (5-engine monitor cycle, 2026-10-17 ~22:10 UTC).

**Live repro.** `GET /api/market/swing/play-brief?playId=SWING:<T>&ticker=<T>&positionId=<n>&expandIntel=1` (production, 2026-10-17), for every currently-committed swing position whose ticker is an ETF:

| Ticker | What it actually is | `ticker_class` returned (pre-fix) |
|---|---|---|
| VXX | Volatility ETN | `"equity"` |
| UVXY | 2x leveraged volatility ETF | `"equity"` |
| SQQQ | 3x inverse Nasdaq ETF | `"equity"` |
| SOXS | 3x inverse semiconductor ETF | `"equity"` |
| UVIX | 2x leveraged volatility ETF | `"equity"` |
| LABD | 3x inverse biotech ETF | `"equity"` |
| NAIL | 3x leveraged homebuilders ETF | `"equity"` |
| ETHA | Spot Ethereum ETF | `"equity"` |
| ETHU | 2x leveraged Ether ETF | `"equity"` |
| URA | Uranium ETF | `"equity"` |

Verified live via `GET /api/market/nighthawk/horizons?view=swings`: all 10 of these were real, currently-committed Night Hawk Swings positions at the time of the repro (63 committed + 5 watch rows total), not hypothetical tickers.

**Root cause, two layers.**

1. `src/lib/swing/play-brief.ts`'s `composeSwingPlayBrief()` hardcoded the literal string `"equity"` at two call sites (inside `buildRichEnvelope({...})` and on the returned `SwingPlayBriefResult`), both carrying the comment "Largo C4 (IDENTITY): swings are always equities." That assumption was true when the field was added, and stopped being true once the Banger whole-market breakout engine started feeding leveraged/inverse/volatility ETFs into the swing lane (`banger-lane-merge.ts`). The type itself was pinned to the literal `"equity"` in `src/lib/swing/play-brief-types.ts` (not the shared `TickerClass` union), so a fix needed a type widen, not just a string swap.

2. Even after wiring in the platform's canonical classifier (`canonicalTicker(ticker)?.kind` from `src/lib/largo/core/entities.ts` — the exact fix already shipped once for this same defect shape in `src/lib/largo/contract/product-adapters.ts`'s cross-product reads), 8 of the 10 live tickers above would have **still** misclassified as `"equity"`: `entities.ts`'s `ETF_KEYS` set is explicitly documented as "partial is safe" because, for its pre-existing callers, `kind` "only affects labelling, never routing." That tradeoff stopped being safe the moment a member-facing Largo identity field (swing's `ticker_class`) started reading it — omission there is a wrong classification a member sees, not a harmless label.

**Blast radius.** Both hardcode sites are in the same function (`composeSwingPlayBrief`), so both needed the fix. The `ETF_KEYS` widening is shared infrastructure (`src/lib/largo/core/entities.ts`), so it also benefits `product-adapters.ts`'s existing cross-product `ticker_class` derivation for these same tickers, wherever they're queried through Helix/Vector/Night Hawk's Largo adapters — a positive side effect, not scope creep, since it's the same shared classifier the sibling fix already depends on.

**Why this wasn't caught by the existing `product-adapters.ts` fix:** that fix only touches the adapters file; it never touched `play-brief.ts`'s own independent hardcode, because the two surfaces compose `ticker_class` through entirely separate code paths (swing's native play-brief composer vs. the cross-product adapter layer for Helix/Vector/Nighthawk/SPX).

**Fix.**
- `src/lib/swing/play-brief.ts`: derive `const tickerClass = canonicalTicker(play.ticker)?.kind ?? "equity";` once near the top of `composeSwingPlayBrief`, and use it at both the envelope-level and result-level `ticker_class` fields instead of the literal `"equity"`.
- `src/lib/swing/play-brief-types.ts`: widen `SwingPlayBriefResult.ticker_class` from the literal `"equity"` to the shared `TickerClass` union (`"index" | "equity" | "etf"`, imported from `src/lib/largo/contract/product-read.ts`).
- `src/lib/largo/core/entities.ts`: added `ETHA, ETHU, LABD, NAIL, SOXS, SQQQ, URA, UVIX` to `ETF_KEYS` — the 8 live swing-book ETFs not already covered by the pre-existing set (`VXX`/`UVXY` were already correctly classified).

**Tests.** Added `entities.test.ts`: all 8 newly-added tickers classify as `"etf"`. Added `play-brief.test.ts`: `composeSwingPlayBrief` returns `ticker_class: "etf"` for SQQQ (both envelope-level and result-level fields) and still returns `"equity"` for a real equity (NVDA). RED→GREEN proven via `git stash` of the 3 source files (2 failures without the fix, 0 with it restored). Broader regression: `src/lib/swing/*.test.ts` + `src/lib/largo/**/*.test.ts` + `src/features/nighthawk/**/*.test.ts` — 4263/4263 pass. `tsc --noEmit`: clean.
