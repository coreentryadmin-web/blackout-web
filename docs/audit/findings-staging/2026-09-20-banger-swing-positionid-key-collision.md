> **kind:** FINDING

# Night Hawk Swings desk: banger-origin MANAGING/SCALING_OUT rows had no `positionId`, colliding into one React key and corrupting the ticker-search list live — FIXED

| | |
|---|---|
| **Status** | FIXED — `src/lib/swing/banger-lane-merge.ts`'s `horizonPlayFromBangerPosition` now sets `positionId: row.id`; regression tests added and RED→GREEN verified. |
| **Surface** | `horizonPlayFromBangerPosition` (`src/lib/swing/banger-lane-merge.ts`), which feeds `terminalPlayFromHorizon`'s `id` template (`src/features/nighthawk/command-deck/adapters.ts`) and ultimately `<PlayCard key={p.id}>` in `CommandDeck.tsx` |
| **Severity** | P2 — real, reproducible member-facing corruption of the Swings desk's ticker search (and, by the same key-collision mechanism, any other React-keyed re-render of the row list), found via a live pixel/UI check this cycle per the standing Ask-Largo-owner mandate's "live UI catches what source review can't" note. |

## How this was found

Per this cycle's instruction to do a live visual check of the Swing desk (`docs/audit/LIVE-UI-CONNECTION.md`), screenshotted `/nighthawk?view=swing` at desktop (1440) and mobile (430) via `proxy-browser.cjs`, then drove real interaction (search box, row clicks) with a custom Playwright script over the same CONNECT-tunnel technique. A first screenshot of a searched ticker looked visually plausible (a scrollable list with a highlighted match at the bottom) — but per this file's own "a default-state screenshot is not a test" discipline, follow-up DOM assertions (`.count()`, `.allTextContents()` on `.nh-deck-play-cell--play`, scoped to the swing board's own `.nh-deck-rows` container) turned a plausible screenshot into a hard reproduction.

## Reproduction (live, `blackouttrades.com`, 2026-09-20)

Typing a REAL held ticker ("CRWD") into the Swings desk's "Search ticker…" box returned 8 rows, not 1:

```
Query "CRWD" -> ["ABTC 10.5C 6DTE", "BLSH 40C 6DTE", "MUU 35C 6DTE", "SNXX 19C 6DTE",
                 "BYND 12.5C 6DTE", "BRUN 18C 6DTE", "ALAB 310C 6DTE", "CRWD 235C 6DTE"]
```

None of ABTC/BLSH/MUU/SNXX/BYND/BRUN/ALAB contain the substring "CRWD" — confirmed directly against the raw API (`GET /api/market/nighthawk/horizons?view=SWING`), where every one of those tickers' `ticker` field is exactly what it displays. Ruled out a filter-logic bug by testing nonsense/absent tickers on the SAME session (`"ZZZQQQNOPE"`, `"NVDA"`) — both correctly returned "No plays match" with **zero** rows, and testing several other REAL held tickers (`"ALAB"`, `"BRUN"`, `"SNOW"`, `"MSTR"`) each returned the SAME 7 unrelated tickers plus its own real match, with the total row count **growing monotonically across successive distinct searches in one session** (9 → 17 → 24 → 32 → 38 rows for 5 sequential real-ticker queries) — i.e. old, already-filtered-out rows were not being cleanly removed from the DOM, a classic symptom of a React key collision, not of `Array.prototype.filter` (`CommandDeck.tsx`'s `searched` memo, verified correct by direct code read: `p.ticker.toUpperCase().includes(q)`).

## Root cause

`terminalPlayFromHorizon` (`adapters.ts`) builds each row's React identity as:

```ts
id: `${src.horizon}:${src.ticker.toUpperCase()}${src.positionId != null ? `:${src.positionId}` : ""}`,
```

`livePlaysFromOpenPositions` (`live-plays.ts`, the native swing-engine live-position mapper) correctly sets `positionId: row.id` for every row, so native swing positions get a unique id per position row (e.g. `SWING:CRWD:39`).

`horizonPlayFromBangerPosition` (`banger-lane-merge.ts`) — which folds Engine B's (Banger) open positions into the SAME Swings desk's MANAGING/SCALING_OUT sections — built its returned `HorizonPlay` object literal WITHOUT a `positionId` field at all. Every banger-origin row therefore collapsed to the bare `SWING:TICKER` id, with NO per-position uniqueness. Live confirmation via the raw API: every one of the 7 "phantom match" tickers is a banger-origin row (`liveStatus: "OPEN"`/`"TRIM"`, `status: "COMMIT"`, section `MANAGING`/`SCALING_OUT`) with `positionId` **absent** from the payload, while CRWD — the one genuinely single-matching row — is a native swing engine position with `positionId: 39` present. Several of the phantom tickers (ABTC, BLSH, SNXX, BRUN, ALAB, BYND) even carry TWO separate banger legs each (one MANAGING, one already-scaled SCALING_OUT) — both sharing the identical collapsed id, guaranteeing a real key collision within the SAME render, not just a theoretical one across renders.

React does not double-render on a key collision; it silently reuses/misattributes the DOM subtree for the colliding key across re-renders, which is the exact shape of what the live search reproduced: typing a new query re-sorted/re-filtered the array, and stale banger rows whose true identity React could no longer distinguish from the newly-matched real row kept bleeding into the rendered list instead of being cleanly unmounted.

## Fix

Added `positionId: row.id` to `horizonPlayFromBangerPosition`'s returned object (`row.id` is `banger_positions`' own auto-increment primary key — unique per banger row the same way `swing_positions.id` already is for the native engine; the two id spaces can't collide against each other because the CommandDeck id template also namespaces on `ticker`, and two different banger legs on the same ticker already have distinct `row.id` values by construction).

`horizonPlayFromBangerWatch` (the pre-entry, no-ledger-commit banger path) was left unchanged — pre-entry rows never held real capital or a DB position row to key off, so there's no `id` to carry, and this finding's reproduction only implicates the LIVE-ledger path (`horizonPlayFromBangerPosition`).

## Evidence

- Regression tests added to `src/lib/swing/banger-lane-merge.test.ts`:
  - `horizonPlayFromBangerPosition carries row.id through as positionId`
  - `two banger-origin plays on the same ticker get distinct positionIds (no CommandDeck key collision)`
- RED→GREEN proven via `git stash` (temporarily reverting only the production fix): 2/14 tests in that file failed pre-fix, 14/14 pass post-fix.
- Full suite: `npm test` → 14899 pass / 0 fail / 3 skipped (pre-existing skips, unrelated).
- `npx tsc --noEmit` → clean.

## Blast radius

Only `horizonPlayFromBangerPosition` needed the fix — `horizonPlayFromBangerWatch` (pre-entry, correctly has no position row to key off) and the native `livePlaysFromOpenPositions` (already correct) were checked and are unaffected. The fix is additive (one new field on an existing object literal) and cannot change any other computed field, gate, or score.
