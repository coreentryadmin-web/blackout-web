> **kind:** FINDING

# Swing play-brief: banger-origin positions unresolvable by `positionId` when a native row shares the ticker

| | |
|---|---|
| **Area** | Night Hawk Swings — Ask Largo play-brief resolution |
| **Severity** | P2 — a member holding a real, live position gets a flat 404 asking Largo about it |
| **Status** | Fixed |
| **Files** | `src/lib/swing/play-brief-resolve.ts`, `src/lib/swing/play-brief-resolve-pure.ts`, `src/lib/swing/play-brief-resolve.test.ts` |

## Root cause

`loadOpenTerminalPlay()` (`play-brief-resolve.ts`) only ever queries the native `swing_positions`
table. A banger-origin position lives in a completely separate table, `banger_positions`, with its
own id space (`banger-lane-merge.ts`'s own doc comment: "a completely separate id space from
swing_positions.id"). The only path a banger-origin row had into a play-brief response was via the
merged lane rows (`getSwingServingLane`, consumed through `loadLaneRows`/`pickLanePlayForBrief`) —
and that merge **drops the banger row entirely once a native-engine row already exists for the same
ticker** (an explicit, deliberate dedup documented in `pickLanePlayForBrief`'s own 2026-10-24 bug-fix
comment, written for a different trigger on this exact PANW pair).

So for a ticker like PANW, which carries both:
- a native `swing_positions` COMMIT row (`id=67`), and
- a separate, fully live `banger_positions` OPEN row (`id=2103`, confirmed via
  `GET /api/market/banger/board`),

the merge keeps only the native row. `loadOpenTerminalPlay`'s own 2026-10-24 "lone candidate" guard
(added for a different PANW incident — an unrelated substitution bug) correctly stops it from
substituting row 67 for a requested `positionId=2103`, but once that guard fails to match, resolution
had nowhere else to go: `?playId=SWING:PANW&ticker=PANW&positionId=2103` returned a flat 404 "play not
found" for a position the member is actually holding right now.

## Evidence

Live-confirmed via direct API calls (temp Clerk admin session, read-only):
- `GET /api/market/banger/board` → PANW `id=2103`, `status=OPEN`, live, real entry/mark.
- `GET /api/market/nighthawk/horizons?view=swings` → only PANW `id=67` (the native row) appears;
  `2103` is absent from the merged view entirely, consistent with the dedup comment above.
- `GET /api/market/swing/play-brief?playId=SWING:PANW&ticker=PANW&positionId=2103` → 404, pre-fix.

Confirmed the same batch's other banger-origin tickers (CRWD, NET, SLB, CART, AI, AMBA, BB) resolved
fine — ruling out a blanket banger-resolution failure and narrowing the root cause specifically to
"a native row for the same ticker exists" (the dedup-drop case), not banger-origin resolution in
general.

## Fix rationale

Additive fallback, not a change to the merge/board-display logic (deliberately out of scope — that
logic's own dedup is intentional for the lane/board views; this fix only concerns the play-brief
resolver, which should still be able to answer about a position that genuinely exists, just not in
the table it looked at first):

- `loadOpenTerminalPlay()`'s two `return null` exits (no native matches at all; native matches exist
  but none satisfy the hints) now fall through to a new `loadOpenBangerTerminalPlay(ticker, hints)`
  whenever `isBangerEngineEnabled()` — additive, so a ticker that only ever lives in `swing_positions`
  behaves byte-identically to before.
- `loadOpenBangerTerminalPlay` fetches `fetchOpenBangerPositions()` and selects the right row via a
  new pure helper, `pickOpenBangerPositionForBrief` (`play-brief-resolve-pure.ts`) — extracted there
  because `play-brief-resolve.ts` pulls in the server-only-guarded DB/Vector import chain and cannot
  be imported from a plain `node:test` file (same reason every other pure helper in that module lives
  there).
- `pickOpenBangerPositionForBrief` mirrors the **same fail-closed rule** `loadOpenTerminalPlay`'s own
  2026-10-24 "lone candidate" guard already applies to the native table: an explicit, unresolvable
  `positionId` must surface as absence, never an unrelated substitute. Concretely: a supplied
  `positionId` matches only an exact id; with no `positionId` supplied, it guesses the ticker's sole
  candidate only when there is exactly one — multiple same-ticker banger rows with no `positionId`
  hint return `null` rather than guessing.

## Blast radius

Single call site inside `loadOpenTerminalPlay`'s own two failure exits — no other code calls
`loadOpenBangerTerminalPlay` or `pickOpenBangerPositionForBrief`. The board/lane merge
(`getSwingServingLane`) and its intentional per-ticker dedup are untouched.

## Tests

Added to `play-brief-resolve.test.ts` (pure, no mocking needed):
- exact `positionId` match among several same-ticker banger rows resolves correctly;
- an unresolvable `positionId` on a ticker with exactly one banger row returns `null` (the core
  regression this fix exists for — mirrors the sibling `pickLanePlayForBrief` PANW test already in
  this file for the lane-merge side of the same incident);
- no `positionId` hint with exactly one row for the ticker resolves that row (the live PANW repro
  shape);
- no `positionId` hint with multiple same-ticker rows returns `null` (fail-closed, no guessing);
- no rows for the ticker returns `null`;
- ticker matching is case-insensitive.

`npx tsc --noEmit` clean. Full test suite run alongside this change.
