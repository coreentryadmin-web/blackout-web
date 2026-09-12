> **kind:** FINDING

## Lane-rank praise/caution lines said "add size"/"leader" on positions already being trimmed or exited — FIXED

| **Status** | FIXED |
|---|---|

### Root cause

`computeLaneRank`/`laneRankCoaching`/`laneRankSection` (`src/lib/swing/play-brief-lane-rank.ts`,
`play-brief-narrative-coaching.ts`) already special-case the rank-1 self-praise line for an
invalidated thesis (#4842, merged earlier the same day — SKHY, via a `selfInvalidated` flag). That
flag is `setupState`-based and only covers WATCH-bucket plays. Every self-referential praise/caution
branch had the SAME class of gap for `manageAction`-based reduce states on COMMIT-bucket plays: none
of them checked whether the play's own manage engine already says "reduce this position."

**Live repro #1 (2026-09-12, CG — below-median branch):** CG sat **#90/90** (dead last) among all
committed positions by raw *entry-time* score (3) — while being the single best-performing REAL
position in the book (**+169.2% mid / +134.6% executable**), already on `manageAction: TAKE_PARTIAL`.
Its own brief's **Trade manager read** led with:

> **Desk says TRIM** — next rail at **+100%**. Bank partial into strength; don't give back peak.

Three bullets later, the same folded narrative said:

> **Below lane median** — **#90/90** (score **3**, -60 vs median). Leader: **AAPL** @ **84.4** —
> confirm before adding size.

**Live repro #2 (2026-09-12, CRWD — found minutes after opening the fix for #1, same root cause,
the rank-1 branch this time):** CRWD sat **#1 of 90** on OPEN by raw score (87) while its own manage
engine was `EXIT_RUNNER` (round-tripped from **+130% peak to -10%**, all trims already banked,
runner only). Its own brief's first bullet said:

> **Desk says TRIM**. **Round-tripped past breakeven** — was up **130%** at peak, now **-10%** —
> consider protecting what's left.

Three bullets later, the SAME folded narrative said:

> **Lane leader** — **#1 of 90** on OPEN (score **87**). Desk attention follows the top row.

Both cases are the identical failure shape as #4842's SKHY repro — a self-referential rank claim
directly contradicting the SAME brief's own management verdict two-to-three bullets away — just
triggered by `manageAction` (a real, live COMMIT-bucket signal) instead of `setupState` (WATCH-bucket
only), which #4842's `selfInvalidated` guard structurally cannot see.

### Fix

Added a `selfReducing` flag to `LaneRankSnapshot`, true when the play's own `manageAction` is
`TAKE_PARTIAL`/`EXIT_RUNNER`/`STOP_OUT`/`EXIT` (distinct from the pre-existing
`EXITING_MANAGE_ACTIONS`, which gates the *named peer* pointer for OTHER tickers, not this play's own
claim about itself). `selfReducing` now gates every self-referential praise/caution branch in both
functions:
- `laneRankSection`'s rank-1 "Top-ranked play... size and attention follow score" line.
- `laneRankSection`'s below-median line, which renders a reduce-aware variant instead of suppressing
  outright (the rank/score standing is still real, honest context worth keeping).
- `laneRankCoaching`'s rank-1 "Lane leader... Desk attention follows the top row" line.
- `laneRankCoaching`'s rank≤3 "Top-tier setup" line (same self-praise shape as rank-1, same fix).
- `laneRankCoaching`'s below-median line, same reduce-aware variant as `laneRankSection`.

A plain `HOLD` (or `ADD`) still gets every original wording unchanged — the fix is additive, gated
narrowly on the reduce-action set, and never touches `rank`/`total`/`medianScore`/`deltaFromMedian`
(computed against the FULL peer set regardless of exit state, per #4825/#4842's existing discipline).

### Blast radius

Both consumers of `computeLaneRank` are fixed by the one change, across all five self-referential
branches now gated. Only plays whose own `manageAction` is a reduce action are affected — a plain
`HOLD`/`ADD` play's narrative is byte-identical to before.

### Fix rationale

Same shape as #4825 (peer-exclusion) and #4842 (`selfInvalidated`): keep the honest numeric standing,
gate only the action-implying tail on the play's own real state. Minimal, additive, no new
computation beyond a field already available on `TerminalPlay` (`manageAction`). The second live
repro (CRWD) was found by re-testing the exact class of bug this PR was already fixing against a
different bucket/branch, immediately after opening it — worth fixing in the same PR since it's the
identical root cause and the same two files, not a second finding.

### Evidence of testing

- 9 new tests total: `selfReducing` true only for the play's own reduce-action state;
  `laneRankSection`/`laneRankCoaching` drop "adding size" wording on the below-median branch when
  `selfReducing`, keep the original wording for a plain `HOLD` (regression guard); both suppress the
  rank-1 "leader"/"top-ranked" praise line when `selfReducing` (CRWD repro), and both still name a
  real leader / render real praise for a healthy (non-reducing) rank-1 setup (regression guard).
- RED→GREEN proven via `git stash` twice — first for the below-median fix (3 assertions fail
  pre-fix), then for the rank-1/top-tier extension (2 more assertions fail pre-fix) — both pass
  post-fix.
- `play-brief-lane-rank.test.ts` + `play-brief-narrative-coaching.test.ts` (91 tests combined): pass.
- `npx tsc --noEmit`: clean.
- Full `npm test` (Node 20): pass, 0 fail (see PR for exact count).

Found during the Night Hawk Swings standing aggressive-mode improvement-hunt mandate — a fresh
full-envelope forensic pass on CG (the strongest real winner in the book) right after confirming
#4842's SKHY fix deployed live, then a follow-up pass on CRWD surfaced the second, closely related
instance minutes later.
