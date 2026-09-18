> **kind:** FINDING

## Ask Largo Swing — two real Banger-engine siblings on the same ticker rendered as identical, indistinguishable "cross-engine position" text — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P3 — member-facing narrative clarity, not a live-trading-path change (display-only) |
| **Component** | `src/lib/swing/play-brief-intel.ts` (`formatOverlapPosition`), `src/lib/swing/portfolio.ts` (`PortfolioPosition`), `src/lib/swing/play-brief-context.ts` (`loadOpenBook`) |
| **Found by** | NIGHT HAWK SWINGS standing audit lane, live CRWD:39 play-brief repro, 2026-09-18 |

### Root cause

`formatOverlapPosition` (added 2026-09-15 for Largo Contract C4, "identity") disambiguates a
same-ticker book-overlap sibling from the reviewed play itself: a swing-native sibling gets
`(separate position #<positionId>)`, and a cross-engine (Banger) sibling — which deliberately never
carries `positionId` (see `loadOpenBook`'s own comment on the `banger_positions`/`swing_positions`
id-collision risk) — got the generic `(separate, cross-engine position)` tag instead.

That 2026-09-15 fix only ever considered ONE cross-engine sibling existing at a time. It never
handled the case of TWO (or more) distinct cross-engine siblings on the same ticker: both would
render the exact same bare tag, with nothing to tell them apart — reading precisely like the
duplicate-counting defect the fix was written to prevent, even though the underlying count was
completely honest (two real, independently-committed positions).

### Evidence

Live CRWD:39 WATCH/OPEN brief, 2026-09-18 (`GET /api/market/swing/play-brief?playId=SWING:CRWD&ticker=CRWD&positionId=39`):

```
**Concentration** — already holding 5 same-direction positions in theme "software": MDB LONG,
NET LONG, CRWD LONG (separate, cross-engine position), SNOW LONG, CRWD LONG (separate,
cross-engine position). CRWD stacks the same wager rather than diversifying risk.
```

Traced: `/api/market/nighthawk/horizons?view=swings` (the DTE-windowed board DISPLAY, which merges
Banger positions via `banger-lane-merge.ts`'s `horizonPlayFromBangerPosition`) shows ZERO other
CRWD rows right now — only the swing-native CRWD:39 itself. But `loadOpenBook()`'s banger merge
(`fetchBangerOpenBookRows()`, `status IN ('OPEN','PARTIAL')`, no DTE filter) is a DIFFERENT read
path with no display-window filtering, and genuinely returned 2 CRWD rows. This is not a
contradiction: `horizonPlayFromBangerPosition` deliberately floors/ceils on DTE for board display
continuity (its own header comment), while book-context correctly needs the FULL open-risk picture
regardless of display eligibility. Confirmed both CRWD entries are real, distinct rows — not a
double-count — but the rendered text gave a member (and this auditor, initially) no way to tell.

### Blast radius

Single formatting function (`formatOverlapPosition`) plus its two upstream data-plumbing sites
(`loadOpenBook` in `play-brief-context.ts`, `PortfolioPosition` type in `portfolio.ts`). Only
affects the rendered LABEL for a cross-engine sibling — `checkPortfolioOverlap`'s own
concentration/conflict DETECTION and COUNT were already correct and are untouched; this is purely
a display-clarity fix. Every WATCH/OPEN swing play whose book overlap includes 2+ Banger positions
on its own ticker was affected (rare — requires the member to hold multiple independent Banger
positions on the SAME name at once — but live and real today, not hypothetical).

### Fix rationale

Added `bangerId?: number` to `PortfolioPosition` (portfolio.ts) — deliberately a NEW, separate
field from `positionId`, not a reuse of it: `positionId` intentionally stays unset on a banger row
specifically because `banger_positions` and `swing_positions` are separate DB sequences that can
collide on numeric id, and `checkPortfolioOverlap`'s `excludePositionId` trusts `positionId` as an
exact identity match for self-exclusion. `bangerId` is never read by that matching/exclusion logic
(verified — only `formatOverlapPosition` reads it), so it carries zero risk of the exact collision
the `positionId`-stays-unset convention exists to avoid. `loadOpenBook` now threads the real
`banger_positions.id` into `bangerId` when mapping banger rows. `formatOverlapPosition` renders
`(separate, cross-engine position #<bangerId>)` when known, falling back to the original bare tag
only when `bangerId` is unavailable (never fabricated).

### Test

`src/lib/swing/play-brief-intel.test.ts`, two new tests:
- `"two distinct cross-engine siblings on the same ticker are told apart via bangerId, not
  rendered identically"` — RED pre-fix (both siblings render the identical bare tag), GREEN
  post-fix (each cites its own `#<bangerId>`).
- `"a cross-engine sibling with no bangerId still falls back to the bare label (never
  fabricated)"` — companion negative case, proves the original 2026-09-15 behavior is preserved
  when no id is known.

Deliberate-break RED→GREEN proof via `git stash`/`git stash pop` on the three source files (test
file kept in place, diff-verified byte-identical restore for all three). `npx tsc --noEmit -p .`
clean (Node 20). `npm test`: 14615/14618 pass, 0 fail, 3 pre-existing skips (Node 20).
