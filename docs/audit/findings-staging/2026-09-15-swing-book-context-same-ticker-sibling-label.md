> **kind:** FINDING

## Swing play-brief Book Context rendered a genuine cross-engine sibling on the reviewed ticker as unlabeled self-citation (Largo C4) — FIXED

**Status:** FIXED — `fix/swing-book-context-same-ticker-sibling-label`

### Root cause

`loadOpenBook()` (`src/lib/swing/play-brief-context.ts:58-89`) merges TWO ledgers into the book
`checkPortfolioOverlap` reads: `swing_positions` (via `fetchOpenSwingPositions()`, real `positionId`
stamped) and `banger_positions` (via `fetchBangerOpenBookRows()`, `positionId` deliberately left
**unset** — documented reason: the two tables are separate DB sequences that can collide on numeric
id, so stamping a Banger row's id as a swing `positionId` risks a wrong exact-match exclusion or
inclusion on a coincidental collision).

`checkPortfolioOverlap`'s exclusion logic (`portfolio.ts:96-107`) has a real, previously-undiagnosed
gap: the `excludePositionId` branch and the ticker+direction self-match fallback are mutually
exclusive (`if (excludePositionId != null && pos.positionId === excludePositionId) continue;` vs.
`if (excludePositionId == null && excludeSelfMatch && ...)`). Once a reviewed play's own
`positionId` is known and passed, the ticker+direction fallback never runs at all — so a genuine
cross-engine Banger sibling on the SAME ticker (positionId always `undefined`, can never match the
exact-id exclusion) correctly falls through and gets counted as real concentration. **That part is
correct** — a real second position on the same ticker is real concentration. But `bookContextSection`
rendered it as bare `"TICKER DIRECTION"` text, textually indistinguishable from a self-citation or
data-duplication defect.

### Evidence

- Live-confirmed on CRWD (2026-09-15): swing-native position #39 (the play under review, correctly
  excluded via `excludePositionId`) coexists with a real, independently-committed Banger-engine CRWD
  LONG (`GET /api/market/banger/board` → `{id: 1123, ticker: "CRWD", contract: {strike: 255, expiry:
  "2026-09-25"}, entry_premium: 4.86, status: "OPEN", committed_at: "2026-09-15T20:15:23.769Z"}`,
  committed ~4h after position #39). CRWD's own Book Context read "already holding N same-direction
  positions... CRWD LONG, PLTU LONG, ZS LONG, NET LONG, PANW LONG" — a real position rendered
  identically to a self-citation bug, prompting an extended cross-session investigation into whether
  the underlying `swing_positions` table had a duplicate row (see #4076 thread; that investigation
  is now correctly narrowed — this defect explains ONE occurrence, not necessarily all of them).
- Confirmed via direct source read that `PortfolioPosition`'s shape (`ticker`, `direction`,
  `positionId?`) is intentionally minimal (portfolio.ts's own comment) — the fix reuses only the
  already-present `positionId` field rather than widening the shared type.

### Blast radius

Single function (`bookContextSection`, `play-brief-intel.ts`) plus a small new local helper
(`formatOverlapPosition`). `PortfolioPosition`'s shape and `checkPortfolioOverlap`'s exclusion logic
(used by the swing GATE too, per `portfolio.ts`'s own header) are untouched — this is a display-only
fix at the one call site that renders overlap names to members/Largo.

### Fix

Added `formatOverlapPosition(p, reviewedTicker)`: when a sibling's ticker differs from the reviewed
play's own ticker, render unchanged (`"TICKER DIRECTION"`); when it MATCHES (the only case that can
read as self-citation), append `" (separate position #N)"` when a real `positionId` is known, else
`" (separate, cross-engine position)"` when it's the Banger-shaped unset-id case. Applied to both
the concentration and internal-conflict name lists in `bookContextSection`.

### Fix rationale

Reused data already on `PortfolioPosition` (`positionId`'s presence/absence already distinguishes
swing-native from cross-engine rows) rather than widening the shared type or touching
`checkPortfolioOverlap`'s gate-facing exclusion logic — both are explicitly out of scope (the gate
caller doesn't need this member-facing disambiguation, and widening `PortfolioPosition` would be a
design-level change affecting a second caller).

### Tests

- `src/lib/swing/play-brief-intel.test.ts`: new test proving a same-ticker cross-engine sibling
  (no `positionId`) is labeled `"(separate, cross-engine position)"` while an unrelated ticker in
  the same theme is unaffected; new test proving a same-ticker sibling WITH a known `positionId`
  cites `"(separate position #N)"`.
- RED→GREEN proof: `git stash` on `play-brief-intel.ts` reproduced 2 failing tests against the
  pre-fix tree; restoring the fix returned the suite to green (131/131).
- `npx tsc --noEmit`: clean.
