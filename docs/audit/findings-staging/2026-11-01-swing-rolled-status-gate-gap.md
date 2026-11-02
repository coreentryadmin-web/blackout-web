> **kind:** FINDING

## Ask Largo swing play-brief: `closedDeckSourceFromRow`'s CLOSED-only gate refused a ROLLED leg's own data, flipping #7316's fix into a 404 — FIXED

| **Status** | Fixed |
|---|---|

**Found by:** live production audit + code read, 2026-11-01, immediately after PR #7316 merged
(`src/lib/swing/play-brief-resolve.ts`'s `loadClosedPlay` exact-id-match fix) — a follow-on gap
caught before it could manifest live (deploy hadn't caught up to #7316 at audit time).

**Root cause:** `closedDeckSourceFromRow` (`src/lib/swing/closed-plays.ts`) gated on the literal
string check `row.status !== "CLOSED"`, refusing to build a card for any row whose status was not
exactly `"CLOSED"`. A chain's ROOT/intermediate leg (one that later rolled forward into a new leg)
has a real DB status of `"ROLLED"`, never `"CLOSED"` — confirmed live (AMZN leg id 44,
`status: "ROLLED"`) and by `src/lib/db.ts`'s own `SWING_TERMINAL_STATUSES` constant
(`new Set(["CLOSED", "ROLLED"])`), which the rest of the ledger already treats as equally
terminal/gradeable (the monotonic status-transition guard, every "closed or rolled" range query).

PR #7316 fixed `loadClosedPlay`'s own id-matching to check the EXACT `r.id === positionId` match
across the whole array *before* falling back to a looser `root_position_id` match — correctly
making a request for a rolled chain's ROOT leg's own `positionId` resolve to that leg's own row
instead of a later rolled-forward child's row. But once that correct row was found,
`closedDeckSourceFromRow(target)` refused it outright (status `"ROLLED"` ≠ `"CLOSED"`), so
`loadClosedPlay` returned `null` — and because `positionId` was explicitly requested,
`resolveSwingPlayForBrief`'s deliberate fail-closed design (its own comments: "an explicit,
unresolvable positionId must surface as absence, never as an unrelated substitute") meant nothing
downstream could substitute a different row either. Net effect: #7316's fix flipped the
user-visible symptom from "serves the wrong leg's data" to a flat 404 "play not found" for every
such request, instead of the root leg's own disclosed outcome (e.g. "-27.7% / rolled") that #7316's
fix implies it now delivers.

**Fix:** loosened the gate to `!SWING_TERMINAL_STATUSES.has(row.status)`, importing that constant
from `db.ts` (now exported) rather than redefining a narrower local notion of "terminal." Kept
`status: "CLOSED"` hardcoded in the returned `SwingClosedDeckSource` for both CLOSED and ROLLED
rows — `TerminalPlay.status` is `DeckStatus` (`command-deck/types.ts`), which has no `ROLLED`
member, and the adapter's own `asStatus()` helper silently coerces any string outside its six-member
whitelist to `"WATCH"`; threading a literal `"ROLLED"` through would have swapped this correctness
bug for a worse one (a settled, graded position rendering as a live WATCH candidate). The leg's own
P&L/contract/dates — not its UI status bucket — are what tell the real CLOSED-vs-ROLLED story, and
`closedReasonFromRow` already derives those honestly from the row's own `realized_pnl_pct` sign,
unaffected by this gate.

**A second, genuine regression surfaced while fixing this — not just loosening the gate.** An
existing 2026-09-11 fix (`resolveSwingPlayForBrief`'s MULTI-ROLL CHAIN FALLBACK) depends on
`closedDeckSourceFromRow` refusing a ROLLED row: for a chain rolled a SECOND time, a caller naming
an *intermediate* leg's own id (e.g. a client that cached it while that leg was still OPEN) is
supposed to walk forward to the chain's current LIVE leg, not that intermediate leg's own stale
snapshot. Once the gate stopped refusing ROLLED rows, the direct `loadClosedPlay(ticker,
positionId)` check (which runs *before* the open-ledger check in `resolveSwingPlayForBrief`) would
short-circuit on the intermediate leg's own now-resolvable data, before the multi-roll fallback
ever got a chance to prefer the live leg — a real, reproducible regression (confirmed by running
the existing 2026-09-11 test, which failed once the gate was loosened without this companion fix).
Fixed by adding a LIVE-CHAIN-CONTINUATION check in `resolveSwingPlayForBrief`: resolve the
requested id's chain root once, and if a currently-live (OPEN/HOLD/TRIM) leg exists anywhere in
that chain, prefer it — run *before* the direct closed/rolled check, so a chain with no live leg
left (every real repro this fix targets: AMZN/AAPL, single-roll, terminal leg CLOSED) falls straight
through unaffected, while a chain that has since rolled further still prefers the live leg exactly
as before.

**Evidence (RED → GREEN):**
- `src/lib/swing/closed-plays.test.ts`: added a test asserting `closedDeckSourceFromRow` resolves a
  `status: "ROLLED"` row's own data (not `null`). RED (gate reverted to the literal `"CLOSED"`
  check via `sed`): the new test failed with a `null` result, matching the live bug. GREEN
  (restored): 39/39 pass.
- `src/lib/swing/play-brief-resolve.test.ts`: added two tests — (1) a single-roll chain's ROOT leg
  (real status `ROLLED`, terminal leg `CLOSED`, no live continuation) resolves the root's own
  -27.7%/`stopped` outcome, not `null`; (2) a chain rolled a SECOND time still prefers the live
  grandchild over the intermediate leg's own now-resolvable snapshot (the regression-guard test).
  RED: both new suites failed (the first with the pre-fix `null`-return bug, confirming the gate
  change alone is necessary). GREEN: 83/83 pass in this file, including the pre-existing
  2026-09-11 multi-roll-fallback test unchanged.
- Full `src/lib/swing/` test directory: 2219/2219 pass. Sibling files `play-brief.test.ts`,
  `play-brief-roll-history.test.ts`, `serving-lane.test.ts`, `play-brief-context.test.ts`:
  242/242 pass. `src/app/api/market/swing/record/route.test.ts` (reaches
  `closedDeckSourcesFromChains`, same shared gate): 5/5 pass after adding the same
  `SWING_TERMINAL_STATUSES` export to its own `../db` mock. `src/lib/db.test.ts`: 46/46 pass.
  `src/features/nighthawk/command-deck/adapters.test.ts`: 163/163 pass.
- `npx tsc --noEmit` (Node 20): clean.

**Blast radius:** `closedDeckSourceFromRow` is the single shared source `loadClosedPlay`
(per-leg Ask Largo brief) and `closedDeckSourcesFromChains` (the `/record` CLOSED-tab composite
list) both build on — fixed once, benefits both callers. Two test mocks of `../lib/db` needed the
newly-exported `SWING_TERMINAL_STATUSES` added alongside their existing `fetchSwingPositionsRange`/
`fetchOpenSwingPositions` stubs (`play-brief-resolve.test.ts`,
`app/api/market/swing/record/route.test.ts`) — both updated in this PR. No gate/scoring logic
changed; this is a pure absence-vs-presence correctness fix plus its one necessary companion
(the live-continuation ordering fix) to avoid trading one bug for another.
