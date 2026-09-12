> **kind:** FINDING

## Ask Largo swing "Book context" concentration check was blind to 94% of the live open book — FIXED

| | |
|---|---|
| **Lane** | Night Hawk Swings — Ask Largo play-brief (`bookContextSection`) |
| **File** | `src/lib/swing/play-brief-context.ts` |
| **Status** | FIXED (this PR) |

### Root cause

`bookContextSection` (`play-brief-intel.ts`) renders theme/direction concentration
(`checkPortfolioOverlap`, `portfolio.ts`) against `ctx.openBook`, populated by
`loadOpenBook()` in `play-brief-context.ts`. `loadOpenBook()` called only
`fetchOpenSwingPositions()`, which reads the `swing_positions` table exclusively.

Engine B (Banger) open positions live in a **separate table**, `banger_positions`, merged into the
Swing lane's DISPLAY only by `banger-lane-merge.ts` (`mergeBangerPositionsIntoSwingPlays`) — nothing
merged them into `loadOpenBook()`'s own read. Confirmed live 2026-09-12
(`GET /api/market/nighthawk/horizons?view=swings`): of 85 currently-open SWING-lane positions, **80
(94%) are banger-origin** and only 5 are swing-ledger-native. Sampling the play-brief
(`GET /api/market/swing/play-brief`) for every one of the 5 swing-native positions (AAPL, NRG, NN,
CG, CRWD) and 4 banger-origin positions (EBS, CRMG, QCML, CRSR) showed **"Book context" never fired
for any of them** — not merely under-firing for the banger majority, but silent for the whole board,
because the 5 swing-native rows happen to share no theme/direction with each other right now, so the
tiny book the overlap check could ever see never overlapped internally either.

This was already half-diagnosed in-repo: `play-brief.ts`'s "BUG FOUND 2026-09-11" comment on
`siblingPositionsNote` explicitly notes banger and swing-ledger rows are separate DB id sequences
that can collide, and deliberately avoided wiring a banger `positionId` into that unrelated feature
for exactly that reason — but nobody had traced the SAME gap forward to `bookContextSection`'s data
source.

### Fix

`loadOpenBook()` now also fetches `fetchBangerOpenBookRows()` (`@/lib/banger/positions-db` — the
same accessor `fetchActiveSwingPlaysForMarks` in `live-marks-active.ts` already uses for the
equivalent merge on the live-marks lane) and maps each row into the same `PortfolioPosition` shape,
gated by the same `isBangerEngineEnabled()` kill-switch (`@/lib/banger/flag`) that lane already
respects — so `BANGER_ENGINE_ENABLED=0` correctly leaves this book swing-only too, exactly as it
already leaves the marks lane and the horizons board swing-only.

Two deliberate, documented choices in the fix:
- **Direction is a hardcoded `"LONG"` constant for banger rows**, not read off a `direction` column —
  `banger_positions` has no such column at all; every banger row is a long call
  (`banger-lane-merge.ts`'s `horizonPlayFromBangerPosition` hardcodes `direction: "LONG"` the same
  way). No normalization ambiguity to get wrong.
- **`positionId` is deliberately left unset** on merged banger rows (never `bangerRow.id`) — per the
  collision risk `play-brief.ts`'s existing comment already documents for this exact pair of tables.
  `checkPortfolioOverlap` falls back to its ticker+direction self-exclusion for these rows, which is
  exact here since the direction is a fixed constant, not a per-row field that could disagree.
- The banger fetch is wrapped in its own try/catch, separate from the swing fetch — a banger-side DB
  hiccup fails soft (keeps the swing-native rows) rather than nulling the whole book, matching the
  per-source fail-soft discipline the rest of `loadSwingPlayBriefContext` already uses.

### Blast radius

Contained to `loadOpenBook()` in `play-brief-context.ts`. `bookContextSection`, `checkPortfolioOverlap`
and `PortfolioPosition` are all untouched — they already accepted an array with or without
`positionId`, so this is purely a wider, more honest INPUT to code that was already correct.

### Fix rationale

This is the "contained wiring gap" case, not the "needs a new shared read across two independent
position stores with real design tradeoffs" case the task considered: `fetchBangerOpenBookRows()`
already exists and is already used by another consumer (`live-marks-active.ts`) for the identical
kind of merge, banger positions carry no direction ambiguity (always long calls), and the one real
design risk (positionId collision across the two id sequences) has a clean, already-precedented
resolution — omit the field and rely on the overlap checker's existing ticker+direction fallback,
which is exact for a constant-direction source. No new shared abstraction was needed.

### Evidence

- Live production reads (`GET /api/market/nighthawk/horizons?view=swings`,
  `GET /api/market/swing/play-brief`, via `scripts/audit/lib/audit-auth-fetch.mjs`): 85 open SWING
  positions, 80 banger-origin / 5 swing-native; "Book context" absent from every sampled brief
  before the fix.
- New tests in `play-brief-context.test.ts` (3): banger-origin rows merge into `ctx.openBook` without
  a `positionId`; `isBangerEngineEnabled() === false` leaves the book swing-only; a banger-fetch
  error fails soft and still returns the swing-native rows. RED→GREEN proven by reverting the fix
  (`git show HEAD:... > play-brief-context.ts`) — the merge test fails (1 !== 3) on the pre-fix file,
  the flag-gate and fail-soft tests hold either way (they exercise paths the pre-fix code already
  handled correctly on its own subset). Restored the fix, all 3 pass.
- Full `src/lib/swing/*.test.ts` (980 tests) and `npx tsc --noEmit`: clean, no regressions.
- Full `npm test` (Node 20, via `scripts/run-tests.mjs`): run alongside this fix.
