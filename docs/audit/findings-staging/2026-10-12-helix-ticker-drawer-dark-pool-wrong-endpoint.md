## 2026-10-12 — [FINDING, P3 HELIX] TickerDrawer's "Dark Pool" section reads the market-wide top-20 feed, filtered client-side — the dedicated per-ticker endpoint exists and is never called — OPEN
> **kind:** `FINDING`

| **Area** | **Severity** | **Status** |
|---|---|---|
| HELIX desk / ticker drawer | P3 — silent undercount, not a crash or a wrong-sign bug | OPEN (write-up only, no code changed) |

**What's wrong.** `src/features/helix/components/TickerDrawer.tsx` (lines 90-98) loads the per-
ticker drawer's "Dark Pool" section with:

```ts
const [fr, dr] = await Promise.allSettled([
  fetchFlows({ limit: 40, ticker: t }),
  fetchDarkPoolPrints({ limit: 20 }),
]);
...
const dp = dr.status === "fulfilled" ? dr.value.prints.filter((p) => p.ticker === t) : [];
```

`fetchDarkPoolPrints` (`src/lib/api.ts:424`, doc comment: *"Dark pool prints — market-wide
institutional off-lit trades"*) hits `GET /api/market/dark-pool`, which has no ticker filter at
all — it returns the **most recent 20 prints across the entire market**, then the drawer filters
that list down to the one ticker client-side. For any ticker that isn't currently among the
market's biggest dark-pool prints (which in practice means anything but SPX/SPY/mega-caps), real
recorded prints for that ticker get crowded out of the global top-20 and the section renders empty
or near-empty even when the ticker genuinely has dark-pool activity on record.

A dedicated per-ticker route already exists and does this correctly: `GET
/api/market/dark-pool/ticker?symbol=<T>` (`src/app/api/market/dark-pool/ticker/route.ts`), with a
matching client helper `fetchDarkPoolTicker(symbol)` (`src/lib/api.ts:470-473`, returning
`{ snapshot: DarkPoolTickerSnapshot | null, symbol }`). Confirmed via repo-wide grep:
`fetchDarkPoolTicker` has exactly one reference in `src/` outside its own definition — itself. It
is never called from any component.

**Why this isn't a mechanical one-line fix (hence write-up, not a patch).**
1. **Allowlist gating.** `dark-pool/ticker/route.ts` gates on `isHeatmapOverlayAllowed(symbol)`
   (`src/lib/heatmap-allowlist.ts:124-127`) — "off-warm-set tickers must not mint a live UW pull
   (2-RPS cluster budget)." Off-allowlist tickers get `{ snapshot: null, symbol }`, never an error.
   So swapping the drawer to the per-ticker route trades a **broad-but-wrong** result (any ticker
   "works," but most get the wrong prints) for a **narrow-but-correct** one (only warmed/liquid
   tickers get real data; everything else honestly shows nothing). That's a real product tradeoff,
   not a bug fix with one obviously correct answer.
2. **Shape mismatch.** `DarkPoolRow` (what the drawer's `dp` state and its rendering currently
   expect) carries `{ ticker, premium, side, executed_at, share_size? }`. `DarkPoolTickerSnapshot`
   carries `{ total_premium, call_premium, put_premium, bias, pcr, detail, prints:
   DarkPoolTickerPrint[] }`, and each `DarkPoolTickerPrint` is `{ strike, premium, side,
   executed_at }` — no `ticker` field (every print is already known to be that one ticker), but a
   `strike` field the drawer's current row renderer doesn't use at all. Swapping the data source
   means either reshaping `DarkPoolTickerPrint[]` into `DarkPoolRow[]` (losing the strike/PCR/bias
   detail the richer snapshot carries) or redesigning the drawer's dark-pool section to show the
   snapshot's own fields (premium split, PCR, bias) instead of a flat print list — a real UI
   decision, not a data-plumbing one.

**Evidence.**
- `src/lib/api.ts:424-432` (`fetchDarkPoolPrints` → `/dark-pool`, no ticker param).
- `src/lib/api.ts:470-473` (`fetchDarkPoolTicker` → `/dark-pool/ticker?symbol=`, defined, zero
  callers via `grep -rn "fetchDarkPoolTicker" src/`).
- `src/app/api/market/dark-pool/ticker/route.ts:14-19` (the `isHeatmapOverlayAllowed` gate,
  `{ snapshot: null }` fallback).
- `src/lib/api.ts:260-289` (the three interfaces, confirming the shape mismatch).

**Blast radius.** `TickerDrawer.tsx`'s own dark-pool section only — no other component reads
`fetchDarkPoolPrints` with a client-side ticker filter the same way (the market-wide dark-pool feed
is used correctly, unfiltered, elsewhere for its own market-wide panels).

**Recommendation (not implemented here).** Switch `TickerDrawer` to `fetchDarkPoolTicker(t)` and
redesign its dark-pool section to show the snapshot's own fields (total/call/put premium, PCR,
bias) plus the `strike`-labeled print list, with an explicit "not enough warmed data for this
ticker" empty state when `snapshot` is `null` — rather than the current silent, wrong-looking empty
list. Left to the owning HELIX lane / operator to decide, since it changes both data source and
section layout.

Found via a background Explore-agent sweep of the HELIX desk (dark-pool/flow logic, admin health
scope, direction/aggression math across ~90 files — no other high-confidence correctness bug
found), independently re-verified line-by-line (confirmed the exact fetch call, the zero-caller
grep on `fetchDarkPoolTicker`, the allowlist gate, and the three interface shapes directly from
source) before writing this up.
