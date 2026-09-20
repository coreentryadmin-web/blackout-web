## Book-context concentration warning rendered a duplicated non-reviewed ticker identically twice — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Status** | FIXED |
| **Area** | `src/lib/swing/play-brief-intel.ts` (`formatOverlapPosition`, `bookContextSection`) |

### How found

Live AGGRESSIVE-MODE audit of a real MANAGING position (RIOT:1203, per the standing Ask Largo ×
Night Hawk Swings mandate). The MANAGING board is heavily concentrated in the `crypto-equity`
theme (11 of 56 positions: SBET, GLXY, MSTX, MSTU, CLSK, HUT, MARA, IREN, COIN, MSTR — confirmed
against `src/lib/portfolio/sector-map.ts`'s own bucket). Pulling RIOT's live play-brief, the "Book
context" section's concentration line read:

> already holding 11 same-direction positions in theme "crypto-equity": SBET LONG, GLXY LONG,
> MSTX LONG, MSTU LONG, CLSK LONG, HUT LONG, MARA LONG, IREN LONG, COIN LONG, MSTR LONG, MSTX LONG.

`MSTX LONG` appears twice, with no distinguishing detail — reads exactly like a duplicate-counting
defect (does the "11" over-count by double-billing one position, or are these genuinely two
separate MSTX holdings?), even though the underlying count is honest: a real swing-native MSTX
position (`positionId` present) and a real, independently-committed cross-engine (Banger) MSTX
sibling both genuinely overlap RIOT's theme.

### Root cause

`formatOverlapPosition` already has disambiguation logic for exactly this "two genuinely separate
positions on one ticker" shape — it was added twice before (2026-09-15 for a single cross-engine
sibling on the *reviewed* play's own ticker; 2026-09-18 extended to disambiguate *multiple* such
siblings from each other via `bangerId`). Both fixes gated the whole disambiguation path behind
`p.ticker.toUpperCase() === reviewedTicker.toUpperCase()` — i.e. they only ever considered the
reviewed play's OWN ticker duplicating in its own overlap list. Neither fix considered a
*different* ticker (not the one being reviewed) duplicating in that same list, which is exactly as
reachable — any theme with more than one real cross-engine sibling on the same non-reviewed
ticker hits it — and reads exactly as suspicious to a member.

### Fix

`formatOverlapPosition` now takes an additional `dupTickers: ReadonlySet<string>` parameter (the
set of tickers appearing more than once in the SAME list currently being rendered, computed by the
new `tickersAppearingMoreThanOnce()` helper). Disambiguation now fires when EITHER condition holds:
the position's ticker is the reviewed ticker (existing rule, unconditional — a single cross-engine
sibling on the reviewed ticker still reads as self-citation-like even at count 1, per the
2026-09-15 fix's own reasoning, so this is additive, not narrowed), OR the position's ticker is a
genuine duplicate elsewhere in the list (new rule). `bookContextSection`'s two call sites
(`sameThemeSameDirection`, `sameThemeOpposedDirection`) each compute their own `dupTickers` from
their own list, since the two lines are independent.

### Blast radius

One file (`play-brief-intel.ts`). `formatOverlapPosition`'s signature changed (new required
parameter) but it has exactly the two call sites inside this same file, both updated. No other
consumer (confirmed via repo-wide grep).

### Verification

New regression test in `play-brief-intel.test.ts`: a book with two genuinely separate MSTX
positions (one `positionId`, one `bangerId`) plus an unrelated single-occurrence MARA, reviewed
from RIOT — asserts both MSTX entries get distinct disambiguating suffixes and the single-occurrence
MARA stays bare (never blanket-applies the suffix to every name).

RED→GREEN proven via `git stash` on `play-brief-intel.ts` alone (test file kept): 1 failure without
the fix (the new test), 0 with it. Full `play-brief-intel.test.ts` suite: 174/174 pass (up from
173, all 173 pre-existing tests unchanged — including the four tests covering the 2026-09-15/09-18
self-ticker disambiguation fixes, none regressed). `npx tsc --noEmit` clean. Full `npm test`
(Node 20) run before opening the PR, result recorded in the PR description.
