## Night Hawk Swings — the WATCH board never pruned/demoted candidates past their own entry-validity deadline, letting a dead setup sit #1 in `sections.WATCH` for weeks — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Lane** | Night Hawk Swings — serving-section router (`src/lib/swing/serving.ts`) |
| **Severity** | P2 (member/Largo-facing trust gap — no bad trade could result, since `entry-enterability.ts`'s real gate already blocks entry on a lapsed deadline regardless of what section the row sits in; this is purely about what the board SHOWS) |
| **Status** | FIXED — `src/lib/swing/serving.ts`, `src/lib/horizon-plays.ts` |
| **Found by** | Standing Ask Largo × Night Hawk Swings ownership mandate (CLAUDE.md), following up on the standing, previously-unresolved `watch-board-stale-expired-candidates-not-pruned` gap first logged 2026-09-12 |

### Root cause

`serving.ts`'s `sectionForSwingPlay` — the ONLY place a swing play's member-facing serving section
(COMMIT_NOW / WAITING_FOR_ENTRY / WATCH / RESEARCH / …) is decided — routed purely off setup
maturity, entry stance, and the mechanical floor gate. It never consulted the entry-validity
DEADLINE (`entry-model.ts`'s sub-lane-scoped window — TACTICAL 2 / STANDARD 3 / EXTENDED 5 trading
days, always strictly shorter than the option's own expiry) even though that deadline was already
computed elsewhere in the codebase for a DIFFERENT purpose: `entry-enterability.ts`'s
`evaluateSwingEntryEnterability` (built 2026-09-12, PR referenced in FINDINGS.md as "WATCH board's
'WAIT' pill gave no member-facing signal...") already returns `expired: true` once the deadline has
passed, and the command-deck adapter (`terminalPlayFromHorizon`, `adapters.ts`) already consumes
that flag to render an honest `EXPIRED` pill instead of a generic `WAIT` — but ONLY at render time,
client-side, on data the raw board API had already served as an ordinary, apparently-live WATCH
candidate.

That 2026-09-12 fix explicitly deferred the harder half of the question (its own write-up:
"Whether/when a stale WATCH row should be actively pruned from the board — that's the
architecturally-significant half of the original #4076 finding, still open, still held pending
Cursor's input rather than shipped unilaterally"). This finding closes that deferred half.

### Reachability / live evidence

`GET /api/market/nighthawk/horizons?view=swings` (the raw board JSON — read directly by Largo's
tools and by any consumer that does not go through the command-deck's client-side adapter layer)
kept serving a stale WATCH candidate at full prominence. Live repro cited when this gap was first
raised (2026-09-12) and reconfirmed structurally unresolved through 2026-09-21: META, first flagged
2026-08-26, sat in `board.lanes.SWING.sections.WATCH` at position #1 (score 84.7) 26+ days past its
own 2-5 day entry-validity window, with the row's own `entryStatus` showing a live-looking
price-vs-trigger geometry rather than any indication the setup was dead. The play-brief layer
(`play-brief.ts`'s `watchEntrySection`) was independently already fixed (2026-09-20) to render
`EXPIRED` for a contract whose OPTION itself expired — a related but distinct clock (see
`entry-model.ts`'s own "TWO invariants" header comment: `entryDeadline !== contract.expiry`) — so a
member reading the play-brief text could already see the setup was dead, while the board's own
ranked WATCH list kept showing it as the #1 candidate.

### Fix

Reused, never re-derived, the exact `evaluateSwingEntryEnterability(...).expired` computation
`terminalPlayFromHorizon` already runs for the client-side pill — a new `entryWindowExpiredFromPlay`
helper in `serving.ts` calls it with the identical inputs (`setupState`/`entryStatus`/`aboveFloor`/
`persistenceObserved`/`commitGateBlockedBy`/`signalKinds`/`archetype`/`subLane`, anchored at
`committedAt ?? firstSeenAt`), so the two can never drift apart. `sectionForSwingPlay` now checks
this new `entryWindowExpired` observable immediately after the existing INVALIDATED check — before
setup maturity, the floor gate, or entry stance are ever consulted — so a lapsed deadline overrides
EVERY other pre-entry section (WATCH, WAITING_FOR_ENTRY, even what would otherwise be COMMIT_NOW)
and routes to RESEARCH instead. Never applies to a live position (`liveStatus` set short-circuits to
the management sections first, exactly as before).

Chose **demote to RESEARCH** over **prune outright**: RESEARCH is this router's existing "not
actionable, needs a fresh read before it can be served again" bucket (already used for INVALIDATED
and unclassified rows) — moving a dead name there keeps its real score/factors/history reachable for
anyone auditing why it went stale (the same "absence is a fact to disclose, not manufacture" honesty
discipline this codebase applies everywhere else — `docs/audit/LARGO-PRODUCT-CONTRACT.md`'s absence
principle), while removing it from every ACTIONABLE bucket a member or Largo could mistake for "still
live." Outright deletion from the served board would have been strictly less informative for the
same engineering cost.

`buildSwingSections` additionally stamps the row with `watchEntryExpired: true` (new optional field
on `HorizonPlay`, `horizon-plays.ts`) whenever this is WHY it landed in RESEARCH — reusing the exact
field name `entry-enterability.ts`'s `deadPlayReason()` already keys on, so any consumer of the raw
board row (not just the command-deck adapter) can render the honest "expired — no longer
actionable" label instead of confusing it with a genuinely-unclassified/invalidated RESEARCH row.

### Blast radius

Single router (`sectionForSwingPlay`) and its one caller (`buildSwingSections`), consumed by
`serving-board.ts`'s `assembleSwingServingLane` (the only place that builds `SwingServingLane.sections`)
and `horizon-board.ts`'s `buildSwingSections(set.SWING)` call for the flat board. `entry-verdict.ts`'s
`resolveSwingServingSection` also calls `sectionForSwingPlay` directly as a test/partial-payload
fallback — left unchanged (it never had `entryWindowExpired` wired and doesn't need to for its narrow
purpose: it's a reconstruction helper, not the primary board path, and the real `play.serving` stamp
already carries the correct answer from `buildSwingSections`). No other call site found (repo-wide
grep for `buildSwingSections`/`sectionForSwingPlay`/`observablesFromHorizonPlay`).

### Fix rationale

Considered computing the deadline fresh inside `serving.ts` instead of importing
`evaluateSwingEntryEnterability` — rejected: that function already encodes the exact sub-lane-day
table, the trading-day-aware advance, and the contract-expiry clamp (`entry-model.ts`/
`entry-enterability.ts`'s own "TWO invariants" and DST-safe trading-day comments), and a second
independent implementation is exactly how this codebase's own FINDINGS.md history shows two
"honest" computations of the same fact silently drifting apart over time. Reusing the one function
also means the board's routing decision and the command-deck's pill can never show a member
inconsistent facts about the same row.

### Evidence of testing

New tests in `src/lib/swing/serving.test.ts` (7 new, all in the file's existing style):
- `entryWindowExpired` overrides COMMIT_NOW/WATCH/WAITING_FOR_ENTRY → RESEARCH.
- `entryWindowExpired` absent/false leaves routing unaffected (no regression on the common case).
- A live position ignores `entryWindowExpired` entirely (liveStatus routes first).
- `observablesFromHorizonPlay` on a WATCH play 26 days past its (STANDARD, 3-day) window reads
  `entryWindowExpired: true`; a 1-hour-old play does not; a live position never does, even with a
  stale `firstSeenAt`.
- `buildSwingSections` on the exact live META repro (26 days stale, score 84.7) shows the row leaves
  `sections.WATCH` entirely and lands in `sections.RESEARCH`, stamped `watchEntryExpired: true`.

RED→GREEN confirmed via `git stash` on `serving.ts` + `horizon-plays.ts` alone (tests kept): 3 of
the 7 new/affected tests fail pre-fix (the META repro's WATCH-exclusion assertion, and the two
`observablesFromHorizonPlay`/`entryWindowExpired`-reading assertions that need the new field to
exist at all), 21/21 pass post-fix (14 pre-existing + 7 new, zero regressions on the pre-existing
suite).

Full `src/lib/swing/serving.test.ts`: 21/21. `npx tsc --noEmit`: clean. Full `npm test` (Node 20):
run alongside this fix, no new failures attributable to this change (see PR for the exact pass
count at merge time).

### Relationship to the standing FINDINGS.md entry

This closes the deferred design question `docs/audit/FINDINGS.md`'s 2026-09-12
`watch-board-stale-expired-candidates-not-pruned` entry left open ("Whether/when a stale WATCH row
should be actively pruned from the board... remains open pending discussion"). That entry's Status
should be updated to FIXED once this staged finding folds — pointing at this entry's PR — rather than
edited directly here (per this directory's own README: staged files are the only way findings reach
`FINDINGS.md`, never a direct edit).
