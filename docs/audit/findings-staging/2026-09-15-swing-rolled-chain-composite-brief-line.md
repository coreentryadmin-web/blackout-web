> **kind:** FINDING

## Ask Largo's play-brief for a rolled/closed swing chain never disclosed the real chain-composite result, only the terminal leg's own — FIXED

| **Status** | FIXED (this commit) |
|---|---|

**What was broken:** live-verified against `https://blackouttrades.com` (INTC's rolled chain,
`rootPositionId: 30`, terminal leg id 35): `GET /api/market/swing/play-brief?playId=SWING:INTC:35`
headlined `"Exit P&L: **-33.2%**"` as the Outcome (repeated in Trade manager read and Lessons) — the
TERMINAL LEG's own exit P&L only. The SAME chain's real composite, per `GET
/api/market/swing/record?days=90` (`record.ts`'s `buildSwingRecord`, the authoritative grader — see
`OUTCOME-GRADING-SPEC.md`): `{"outcome":"loss","worstLegPnlPct":-40.83,"sumPnlPct":-74.02,
"compoundedReturnPct":-60.47}`. A member reading the detailed Ask Largo brief for a rolled
position — the surface specifically built to explain a trade in depth — saw a materially
better-looking loss (-33%) than the trade's real outcome (-41% to -60%+ depending on measure), with
no line anywhere in that brief pointing at the worse composite number.

**Root cause:** deliberate, but the tradeoff was never fully closed out. `loadClosedPlay`
(`play-brief-resolve.ts:187-188`) intentionally uses the per-leg row's own exit P&L rather than the
chain composite — correctly avoiding a real prior bug (`closed-plays.ts`'s header, 2026-09-15: pairing
the chain-composite P&L with the TERMINAL leg's own peak/trough price bounds produced a nonsensical
positive "+25.7% peak" next to a "-40.83%" composite exit for a chain where the worst leg wasn't the
terminal one). But `play-brief-types.ts`'s original comment justified omitting the roll-history line's
P&L on the premise that "the chain composite already owns P&L semantics per record.ts" — that premise
was false for THIS surface: the composite was only ever surfaced in `record.ts`'s own Closed-tab list
view, never inside the play-brief itself. The intended division of labor (list view owns composite,
brief owns per-leg detail) was never actually wired end-to-end.

**Blast radius:** every rolled/closed swing chain's play-brief (any position that hit `roll.ts`'s
`decideRollAction` at least once before closing).

**What changed — one additional sentence, not a headline replacement:**
- `loadRollHistory` (`play-brief-context.ts`) already fetches the full chain via
  `fetchSwingPositionChain` to build the roll-history disclosure; it now also calls
  `buildSwingRecord(chain).composite` — the EXACT SAME function `/api/market/swing/record` and the
  Closed-tab list view already use, never recomputed here — and attaches it as `chainComposite`, but
  ONLY once `composite.chainResolved` is true (never a premature composite for a still-open/rolling
  chain).
- `rollHistoryLine` (`play-brief-narrative.ts`) appends one additional sentence citing the composite's
  own scalar fields as plain text (`"Full chain result: **-60.5% compounded** (loss, worst leg
  -40.8%) — this leg's own exit P&L above is only part of the story."`) — deliberately never blended
  with the terminal leg's own price/peak/trough numbers in the same clause, which is exactly the
  pairing that caused the prior bug this fix is careful not to reopen.
- The per-leg headline (`Exit P&L`) itself is untouched — this was the safest of three options
  discussed on #4076 (comment 5682144526 / 5682367688): adding a reference line rather than replacing
  the headline (risks the mismatch bug) or showing two competing numbers side-by-side in the same
  section (confusing, no clear "which number matters").

**Test:** RED→GREEN proven (`git stash` on the three source files): the new
`"rolled-and-resolved chain also cites the REAL chain-composite result"` test fails pre-fix, passes
post-fix. Also added a negative test proving a still-open rolled chain (`chainComposite: null`)
correctly omits the sentence rather than fabricating one, and updated the two pre-existing
roll-history tests with an explicit `assert.doesNotMatch(.../Full chain result/)` to guard the
no-composite case stays silent. Full `src/lib/swing/*.test.ts` + `src/features/nighthawk/command-deck/*.test.ts`
(1590 tests) green on Node 20 with `--experimental-test-module-mocks`, `tsc --noEmit` clean.

**Collaboration note:** the design question (which of three options to ship) was raised on #4076
(comment 5682144526) and a parallel Night Hawk session independently converged on the same answer
(comment 5682367688) before this was implemented — see that thread for the full discussion.
