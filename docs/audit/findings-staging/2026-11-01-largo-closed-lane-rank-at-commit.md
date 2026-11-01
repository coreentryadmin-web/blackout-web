> **kind:** FINDING

## Ask Largo / swing play-brief — CLOSED positions carry no lane-rank context at all (Largo Contract C10 — historical context) — FIXED

| | |
|---|---|
| **Area** | Swing commit pipeline (`src/lib/swing/commit.ts`), CLOSED-deck reader (`src/lib/swing/closed-plays.ts`), Command Deck adapters (`src/features/nighthawk/command-deck/adapters.ts`, `types.ts`), play-brief lane-rank section (`src/lib/swing/play-brief-lane-rank.ts`, `play-brief-intel.ts`) |
| **Severity** | P3 — Largo product-contract **C10 (historical context)** gap, member-facing |
| **Status** | Fixed |
| **Found by** | Ask Largo × Night Hawk Swings standing ownership mandate (`CLAUDE.md`), 2026-11-01 |

### Root cause

`src/lib/swing/play-brief-lane-rank.ts`'s `computeLaneRank` ranks a play against its LIVE OPEN/WATCH
board peers (`laneRows: HorizonPlay[]`), but explicitly returns `null` the instant
`bucketFor(play) === "closed"` (`if (bucket === "closed") return null;`). That is the correct call —
there is no live board left to rank a closed position against after the fact — but it leaves a real
gap: once a swing position closes, its play-brief carries **zero** lane-rank context, forever. A
member reading a CLOSED brief had no answer to "was this actually a strong idea when it got
promoted, or did it barely clear the bar?" — the Largo product contract's C10 point (`docs/audit/
LARGO-PRODUCT-CONTRACT.md`) says exactly this kind of historical-context fact should be exposed
structurally when a product can answer it, not silently dropped.

It *can* be answered, just not from the live board — `computeSwingCommitPlan` (`commit.ts`) already
builds `ordered = [...args.candidates].sort((a, b) => b.score - a.score || a.ticker.localeCompare(b.ticker))`
to decide commit order across the SAME-SCAN batch of WATCH candidates competing for capital that
session. That list is a real, already-computed "lane" — reusing it at the exact moment of commit
costs zero new data fetches and is 100% pure/deterministic, unlike trying to retroactively
reconstruct some arbitrary past live-board snapshot (which was never persisted and cannot be
recovered).

### Evidence

Confirmed via git log/PR history that no sibling PR shipped this under another name — a genuine,
unshipped gap, not a duplicate of the live `laneRankSection`/`computeLaneRank` path, nor of the
2026-10-26 `budgetVerdict`/`bookRiskLine` work (`#4076` comment 6410025245), which pins a different
fact (book-heat budget headroom) at the same commit moment but says nothing about where the
candidate ranked among its peers.

Probed the new pure helper directly against a 3-candidate batch (NVDA score 85 / AAPL 60 / TSLA 40,
all committable): `lane_rank_at_commit` on each committed row's `entry_context` matched the hand
computation exactly —

```
NVDA  { rank: 1, total: 3, score: 85, medianScore: 60, deltaFromMedian: 25 }
AAPL  { rank: 2, total: 3, score: 60, medianScore: 60, deltaFromMedian: 0 }
TSLA  { rank: 3, total: 3, score: 40, medianScore: 60, deltaFromMedian: -20 }
```

and a single-candidate batch stamps `lane_rank_at_commit: null` rather than a fabricated "#1 of 1".

### Fix

Added `LaneRankAtCommit` (rank/total/score/medianScore/deltaFromMedian) and a pure
`laneRankAtCommitFor(cand, ordered)` helper to `commit.ts`, computed once per candidate inside the
existing `for (const cand of ordered)` loop and threaded **only** into `buildCommitInsert` (real
positions) — never into `buildShadowInsert` (shadow rows are a separate table never rendered in the
play-brief CLOSED bucket, matching the originally scoped idea). Pinned alongside the existing
`signal_kinds` field in `entry_context.lane_rank_at_commit`. A structural parser
(`parseLaneRankAtCommit`, mirroring `swing-portfolio-budget.ts`'s `parseBudgetVerdictStamp`
convention exactly — validate every field is a finite number, null on any mismatch, never trust the
raw JSONB) carries it back out at read time.

Threaded the field through the existing CLOSED-deck pipeline, each hop following the file's own
`budgetVerdict` precedent byte-for-byte: `SwingClosedDeckSource.laneRankAtCommit` (`closed-plays.ts`,
wired from `row.entry_context?.lane_rank_at_commit ?? null`) → `HorizonDeckSource.laneRankAtCommit`
(`adapters.ts`, doc-commented "CLOSED SWING only" the same way `trimEnforcedBeforeClose` already is
on that shared type) → `TerminalPlay.laneRankAtCommit` (`types.ts`), parsed structurally at the one
real parse site inside `terminalPlayFromHorizon` and forwarded raw (unparsed) from
`terminalPlayFromClosedSwing`'s literal into that same function — exactly the two-call-site shape
`budgetVerdict` already uses.

New `closedLaneRankSection(play)` in `play-brief-lane-rank.ts` renders the fact in past-tense,
commit-time framing ("**#2 of 5** WATCH candidates this scan · score **61** (+3 vs batch median)" /
"Batch median at commit: **58**", plus a "Top-ranked candidate in its commit batch." line when
`rank === 1`), gated strictly to `play.status === "CLOSED"` and to a present `laneRankAtCommit` —
honest absence on any pre-fix historical row, never backfilled. Wired into `play-brief-intel.ts`
right after the existing `laneRankSection` call; the two are mutually exclusive in practice (one is
null exactly where the other is non-null — live board rank vs. commit-time rank), so no dedup logic
was needed.

### Blast radius

- `src/lib/swing/commit.ts` — purely additive: `computeSwingCommitPlan`'s gating logic
  (`committable`/`blockedBy`/every existing gate decision) is **completely unchanged**; the new
  field is observability-only and never read by any gate.
- `src/lib/swing/closed-plays.ts` — one new required field on `SwingClosedDeckSource`, wired from
  the existing `entry_context` read, no behavior change to any existing field.
- `src/features/nighthawk/command-deck/adapters.ts`/`types.ts` — one new optional field on
  `HorizonDeckSource`/`TerminalPlay`, following the `budgetVerdict`/`trimEnforcedBeforeClose`
  precedent exactly; both existing call sites (`terminalPlayFromHorizon`,
  `terminalPlayFromClosedSwing`) keep every other field untouched.
- `src/lib/swing/play-brief-lane-rank.ts`/`play-brief-intel.ts` — one new exported function, one new
  `safeSection` call; the existing `laneRankSection`/`computeLaneRank` live-rank path is untouched.

### Tests

`src/lib/swing/commit.test.ts` — 4 new cases: a 3-candidate batch's `lane_rank_at_commit` matches
hand-computed rank/median/delta for every committable decision; a single-candidate batch stamps
`null`; `parseLaneRankAtCommit` round-trips a real stamped value; `parseLaneRankAtCommit` returns
`null` on garbage input (wrong types, missing fields, non-object, `null`/`undefined`).

`src/lib/swing/play-brief-lane-rank.test.ts` — 4 new cases for `closedLaneRankSection`: renders the
formatted section for a CLOSED play with a pinned commit-batch rank; names a top-ranked commit-batch
position explicitly; returns `null` when `laneRankAtCommit` is absent (both `undefined` and
explicit `null`); returns `null` when `play.status` is not `"CLOSED"` even when `laneRankAtCommit`
happens to be present (defensive — the function's own gate, not caller discipline, must enforce
this).

RED→GREEN verified: reverted all six touched source files to pre-fix `origin/main` content (test
files kept), ran both suites — 4 failures in each (`is not a function` on
`parseLaneRankAtCommit`/`closedLaneRankSection`), exactly as predicted. Restored the fix —
48/48 (`commit.test.ts`) and 41/41 (`play-brief-lane-rank.test.ts`) pass. `tsc --noEmit` clean.
Full `npm test` run — see PR for the result (this touches `TerminalPlay`, a widely-consumed type,
so the full suite was run, not just the touched files).
