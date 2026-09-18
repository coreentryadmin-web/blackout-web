> **kind:** FINDING

## Night Hawk Legacy — no inline track-record visibility in the member-facing pick-log table — FIXED

| **Status** | FIXED |
|---|---|

**Root cause.** Item #14 of the operator's 15-point continuous-learning mandate asked for a
member-facing "morning command-center table" for Night Hawk Legacy. Scoping this (rather than
building blind) found the table itself already exists and is rich —
`src/features/nighthawk/components/LegacyPickLogBoard.tsx`, a sortable `VectorBoardDataTable` with
tabs, calendar, macro strip, session scorecard, compare mode, and CSV export, fed by
`LegacyDeck` (`src/features/nighthawk/command-deck/containers.tsx`). The genuine gap was narrower:
`containers.tsx:405-438` already fetches `/api/market/nighthawk/record` and attaches a
per-conviction-tier win-rate/CI/n scorecard (`TerminalPlay.scorecard`) to every play, and
`legacyScorecardLine()` (`legacy-board-detail-copy.ts:29-39`) already formats it — but that line
was rendered **only** in `LegacyPlayTechnicalsRail.tsx`, the detail rail that opens after clicking
a row. A member scanning the table itself had no at-a-glance signal of a pick's historical
calibration; they had to open every row individually to see it.

**Evidence.** `legacy-board-columns.tsx`'s `buildLegacyBoardColumns` "Pick" cell
(`legacy-board-columns.tsx:74-99`, before this fix) rendered ticker/contract/tier/direction/rank
only — no calibration data, despite `row.play.scorecard` being available on every row already
(it's the same object `legacyScorecardLine` reads). Confirmed via `LegacyBoardTableRow = ... & {
play: TerminalPlay }` (`legacy-board-table-utils.ts:20`) that the full `TerminalPlay` (including
`scorecard`) is already on every row the column renderer receives — this was a pure render/wiring
gap on data already flowing to the client, not a missing fetch or a new API.

**Blast radius.** Single call site — `legacy-board-columns.tsx`'s "pick" column is the only place
that builds Legacy table rows; `VectorBoardDataTable` (the shared board-table renderer) is
untouched. No other desk (0DTE/Swing/Vector) shares this column-builder file.

**Fix.** Added `legacyScorecardBadge(play)` to `legacy-board-detail-copy.ts` — a compact one-line
variant of the existing `legacyScorecardLine` (round win rate + `n`, no CI/avg/scope clutter,
since a table row has no room for the full line) — and rendered it in the "Pick" cell as a new
`<div className="vector-board-pick-scorecard">`, shown only when `play.scorecard` is present (no
fabricated "no data" state). Discovered along the way: the existing `vector-board-pick-id` line
(tier/direction/rank) is hidden via `.nh-v2-page .vector-board-pick-id { display: none; }`
(`vector-board-controls.css:274`) on the live page — so the new badge uses a fresh, undecorated
CSS class (`vector-board-pick-scorecard`, styled in `globals.css`/`nighthawk-desk-theme.css`
mirroring `pick-id`'s existing small/muted treatment) rather than reusing that hidden element.

**Rationale.** Kept minimal and additive: no new API call, no schema change, no new component —
purely a render of data the client already has. Left `legacyScorecardLine`'s full CI/avg detail
in the click-through rail unchanged (it still has room for the richer line); the table gets only
the compact signal a member needs to decide whether to click in. Did not attempt the desk-level
`win_rate_pct`/`decided_count` addition to `VectorBoardScorecard`'s header (a second, separable
idea raised during scoping) — kept this PR single-issue per the standing issue-handling policy.

**Sample size / evidence for `n`.** Not a data-correctness finding — no backtest needed; this is a
render-wiring fix verified by `npx tsc --noEmit` (clean) and the new
`legacy-board-detail-copy.test.ts` (6/6 passing, covering both the existing untested
`legacyScorecardLine` and the new `legacyScorecardBadge`, including the n=0 edge case), plus a full
`npm test` run (14808/14808 passing, 0 regressions).

**Next action.** None — the render-only fix is complete and covered by tests. The desk-level
scorecard header addition remains a separate, optional follow-up if wanted later.
