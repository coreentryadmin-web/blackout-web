> **kind:** FINDING

## Ask Largo swing play-brief: a WATCH candidate matching an existing held position's own ticker+direction was silently treated as "self" — zero concentration warning on the exact "about to double an identical wager" case — fix/book-context-watch-self-exclusion — 2026-09-21

| **Status** | FIXED |
|---|---|

- **What was broken:** `bookContextSection` (`src/lib/swing/play-brief-intel.ts`) calls
  `checkPortfolioOverlap` to detect theme/direction overlap with the open book. When the reviewed
  play has a resolvable ledger `positionId` (any already-committed OPEN/HOLD/TRIM position), it
  correctly passes `{ excludePositionId }` to exclude exactly that one row by identity. But a WATCH
  candidate — the pending-entry-decision case this whole section is written FOR ("Adding {ticker}
  stacks the same wager…") — never carries a ledger `positionId` at all: `play.id` is only ever
  stamped `${horizon}:${ticker}${positionId ? ":"+positionId : ""}` (see
  `banger-lane-merge.ts`'s own comment), so `parseSwingPlayId` returns `positionId: null` for
  every WATCH play. The call site fell through to passing `undefined` options, which means
  `checkPortfolioOverlap`'s DEFAULT `excludeSelfMatch: true` — a fallback the module's OWN doc
  comment explicitly scopes to an already-committed play re-reading its own row: "Gate callers
  evaluating an uncommitted dossier should pass false so a lone pre-existing same-ticker/
  same-direction row is counted as concentration." `bookContextSection` on a WATCH play IS exactly
  that uncommitted-dossier caller, but never passed it. Net effect: a trader looking at a WATCH
  signal for a ticker they ALREADY hold in the SAME direction saw the existing position silently
  matched as "self" and excluded — producing **zero** concentration warning on the single clearest
  case the feature exists to catch (stacking an identical bet on a name already held).
- **Evidence:** live repro reduced to a minimal fixture — `bookContextSection` called with a WATCH
  `NVDA LONG` candidate (`id: "SWING:NVDA"`, no positionId) against an open book containing a bare
  `{ ticker: "NVDA", direction: "LONG" }` row (the exact shape `loadOpenBook` produces for any
  position). Pre-fix (`git stash` on the implementation, `/tmp/repro2.mjs`): `bookContextSection`
  returned `null`. Post-fix: returns a "Book context" section reading `**Concentration** — already
  holding 1 same-direction position in theme "semis": NVDA LONG (separate, cross-engine position).
  Adding NVDA stacks the same wager rather than diversifying risk.` — the intended behavior.
  Existing test at `play-brief-intel.test.ts` line 83 ("a duplicate/rolled row on the SAME
  ticker+direction is not reported as overlap") had been asserting the buggy behavior all along —
  it used the fixture's default WATCH status, so it was itself an accidental regression pin for
  this exact bug rather than a test of the self-exclusion fallback it was meant to describe
  (a rolled/re-labeled ALREADY-COMMITTED position, which does need self-exclusion). Corrected that
  test to use `status: "OPEN"` (the scenario it actually describes) and added a new test that
  pins the corrected WATCH behavior.
- **Blast radius:** single call site — `bookContextSection` is the only caller of
  `checkPortfolioOverlap` that reaches this branch (the swing entry gate's own caller in
  `gates-pr5.ts` already passes `excludeSelfMatch: false` explicitly for its uncommitted-candidate
  evaluation, per `portfolio.ts`'s doc comment — that path was already correct). No other section
  reads `checkPortfolioOverlap`'s output.
- **Fix rationale:** compute `isPendingEntryDecision` before the overlap call (previously computed
  after, for narrative phrasing only) and pass `{ excludeSelfMatch: false }` whenever there is no
  real ledger id to exclude by AND the play is still WATCH — a matching book row can only be a
  genuine distinct position in that case, never "the candidate re-reading itself," so excluding it
  can only ever hide a real signal. Left the `positionId != null` branch (committed plays)
  completely untouched, and left the narrow `positionId == null && status != WATCH` edge case
  (a committed play whose id is missing/malformed for some other reason) on the old conservative
  default, since there the matching row genuinely could be the candidate's own self under a
  stale/unresolved id and excludeSelfMatch:false would be the wrong default to force blind.
- **Test:** `src/lib/swing/play-brief-intel.test.ts` — one existing test corrected (was pinning the
  bug), one new test added pinning the fix. RED→GREEN proven via `git stash` on the implementation
  file alone (`npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief-intel.test.ts`):
  1/181 failed pre-fix (the corrected test, run against the OLD implementation, correctly fails —
  see PR diff for the exact stash sequence), all 181 pass post-fix. `npx tsc --noEmit` clean.
