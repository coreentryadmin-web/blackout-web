> **kind:** `FINDING`

## Ask Largo swing brief's "Drawdown before outcome" post-mortem line rendered a false claim when the trough WAS the exit — FIXED

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Area** | Night Hawk Swings command-deck / Ask Largo play-brief (`src/lib/swing/play-brief-narrative-coaching.ts`) — found via the Ask Largo standing mandate's 5-engine health-check deep-dive |
| **Severity** | P2 (a member-facing post-mortem line asserted "there was a real intra-trade swing to learn from" on a position where the trough and the exit were the same event — misleading in exactly the case a reader would trust it most: a stopped-out loss) |
| **PR** | fix/swing-drawdown-before-outcome-redundant |

### Root cause

`closedCoaching()`'s "Drawdown before outcome" line (added same-day, 2026-09-18) fires whenever
`play.trough < 0 && play.peak - play.trough >= 40` — proving the peak-to-trough SWING was large,
but never checking whether `trough` is actually distinct from the position's final `exitPnlPct`.
For a STOPPED close, the stop mechanically fires at (or within rounding noise of) the worst mark
recorded — so `trough` and `exitPnlPct` are routinely the same number. The line's own claim ("note
the real intra-trade swing … when sizing or setting stops") implicitly asserts a SEPARATE low point
existed before the outcome — a recovery-then-relapse pattern worth learning from — which is false
when the trough simply *was* the outcome and nothing recovered.

Live repro (real production data via an authenticated Clerk session), CLOSED/stopped position
NN:32: the brief rendered *"dipped to **-60.3%** at its worst before closing at **-60.3%**"* — both
numbers `fmtPct`'d to the identical displayed figure.

### Evidence

- `play-brief-narrative-coaching.ts` (pre-fix, `closedCoaching()`): the gate checks
  `typeof play.trough === "number" && Number.isFinite(play.trough) && play.trough < 0 &&
  typeof play.peak === "number" && Number.isFinite(play.peak) && play.peak - play.trough >= 40`
  — no comparison against `play.exitPnlPct` anywhere in the condition.
- `adapters.ts:746`: `exitPnlPct?: number | null` — confirmed nullable/finite-checkable, the same
  shape the fix's new guard clause already expects.
- Existing test coverage checked before touching anything: the one prior test
  (`"discloses a real drawdown before outcome"`) only exercises a trough materially far from the
  exit — it never asserted the near-identical-to-exit case as intentional, confirming this was a
  genuine unguarded gap, not an accepted tradeoff.

RED→GREEN proof (independently reproduced on a fresh `fix/swing-drawdown-before-outcome-redundant`
branch off actual latest `origin/main`, which already includes #5196's merge):
- Reverted `play-brief-narrative-coaching.ts` via `git stash`, kept the tests. `npx tsx
  --experimental-test-module-mocks --test src/lib/swing/play-brief-narrative-coaching.test.ts`:
  **1 failure** (the new near-identical-trough test) — 109/110 pass, nothing pre-existing broke.
- Restored (`git stash pop`). Re-ran the same file: **110/110 pass**. Broader sweep (all
  `play-brief*.test.ts` files): **635/635 pass**.
- `npx tsc --noEmit -p .` on Node 20: clean.

### Blast radius

Single-file fix: `src/lib/swing/play-brief-narrative-coaching.ts`'s `closedCoaching()` only. The
shallow/never-negative/missing-trough cases were already correctly guarded by the pre-existing
conditions and are untouched. `closedCoaching` is shared render logic for the CLOSED bucket's
post-mortem coaching — every Ask Largo brief for a closed swing position benefits from the fix at
this one call site.

### Fix rationale

Minimal, targeted: added one additional condition —
`typeof play.exitPnlPct === "number" && Number.isFinite(play.exitPnlPct) && play.exitPnlPct - play.trough >= 5`
— so the line only fires when there's a genuine gap between the low point and the actual exit (the
position recovered meaningfully off its trough before finally closing). A 5-point floor (versus the
existing 40-point peak-to-trough threshold) is deliberately much smaller: it only needs to rule out
"trough and exit are effectively the same event," not re-litigate whether the overall swing was
large enough to be worth noting (that's already the existing 40pt gate's job). When `exitPnlPct` is
null/non-finite, the line is suppressed rather than fabricating a claim off missing data — honest
omission, consistent with the file's existing discipline elsewhere.

### Verification

Independently re-verified from scratch on a fresh branch off actual latest `origin/main` (post
#5196), not the originating research agent's own working-tree state — the claimed pre-existing gate
condition, the `exitPnlPct` field's nullable type, and the existing test's scope were all
independently grep-verified; RED/GREEN reproduced independently; broader `play-brief*.test.ts` sweep
(635/635) and `tsc --noEmit` both clean.
