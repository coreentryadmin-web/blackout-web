> **kind:** `FINDING`

## Ask Largo swing brief's "next trim" narration showed only percent-from-entry, never distance-from-current-mark — FIXED

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Area** | Night Hawk Swings / Ask Largo (`src/lib/swing/play-brief-narrative-coaching.ts`) |
| **Severity** | P3 (a real, already-computed dollar level was discarded in favor of a less-actionable percent-from-entry framing — not a crash/incorrect-number bug) |
| **PR** | fix/swing-next-trim-distance |

### Root cause

`buildTerminalExitLadder` (`src/lib/zerodte/terminal-ladder.ts:71-104`) computes `premium` — the
ABSOLUTE per-contract dollar level each `trim_levels` rung fires at (`entry × (1 +
trigger_pct/100)`, rounded to 2dp) — for EVERY tranche, fired or not (`terminal-ladder.ts:22-26`'s
own doc comment: "Null premium when the row has no entry basis to price the level off — never a
guess"). `play-brief.ts` already reads this field for FIRED rungs (the "Banked: 50% @ +100%
($4.20)" line).

But `play-brief-narrative-coaching.ts`'s `manageLifecycleCoaching()` — the OPEN-bucket trim-ladder
narration — only ever read `next.trigger_pct` for the UNFIRED next rung, never `next.premium`, and
never compared either against `play.mark`. A member reading "next trim at +100%" had no way to
tell whether that rung is 3 points or 60 points away from the position's CURRENT mark — only how
far it is from entry, a materially different (and less actionable) framing once a position already
carries an unrealized gain: two positions both showing "next trim at +100%" could be genuinely
3-points-away and 60-points-away and read identically.

### Evidence

Grep evidence (pre-fix, on `origin/main`, which already includes #5190):
- `terminal-ladder.ts:22-32`: `TerminalExitTranche.premium: number | null` — "the ABSOLUTE
  per-contract level (entry × (1 + trigger_pct/100)) the tranche banks at."
- `terminal-ladder.ts:82-95`: `levelFor(pct) = hasEntry ? round2(entryPremium * (1 + pct/100)) :
  null` — computed for every `trim_levels` entry via `.map`, fired or not.
- `play-brief.ts:365-371`: `t.premium` already read for FIRED trims (the "Banked" line).
- Zero pre-existing hits for `next.premium`/distance-to-mark logic in
  `play-brief-narrative-coaching.ts`'s `manageLifecycleCoaching`, verified by isolating the file
  via `git stash` before the fix.

RED→GREEN proof (independently reproduced on a fresh `fix/swing-next-trim-distance` branch off the
actual latest `origin/main`, which already includes #5190's merge):
- Reverted `play-brief-narrative-coaching.ts`, kept the tests. `npx tsx
  --experimental-test-module-mocks --test src/lib/swing/play-brief-narrative-coaching.test.ts`:
  **1 failure** (the new distance-disclosure test) — the expected "field/branch doesn't exist yet"
  shape. 108/109 pass, nothing pre-existing broke.
- Reapplied. Re-ran the same file: **109/109 pass**. Broader sweep (`play-brief-narrative-
  coaching.test.ts` + `play-brief-narrative.test.ts` + `play-brief.test.ts` +
  `play-brief-intel.test.ts`): **439/439 pass**.
- `npx tsc --noEmit -p .` on Node 20: clean.
- Full `npm test` suite (Node 20): result to be appended once the background run completes.

**Correctness check performed during independent verification (not part of the original fix, a
sanity check on the math before shipping):** confirmed `pnlPct` (`live-plays.ts`'s `livePnlPct`,
`round(((mark/entry - 1) * 100) * 10) / 10`) and `premium` (`terminal-ladder.ts`'s
`round2(entryPremium * (1 + pct/100))`) are both derived from the SAME `entry`/`mark` values at the
same call site (`live-plays.ts:583`), so the `alreadyCrossed` gate (based on `pnlPct >=
trigger_pct`) and the new distance suffix (based on `mark` vs `premium`) can never meaningfully
disagree — any discrepancy is bounded by sub-cent rounding, never a stale-data mismatch that could
produce a nonsensical negative "% from here."

### Blast radius

Single-file addition to one narration branch:
- `src/lib/swing/play-brief-narrative-coaching.ts` — `manageLifecycleCoaching()`'s not-yet-crossed
  "next trim" clause only. The "already cleared, not yet banked" branch is deliberately untouched
  (the distance figure is moot/negative there — `alreadyCrossed` already covers that case).

No new fields threaded through the data model — `next.premium` and `play.mark` were both already
present on `TerminalExitTranche`/`TerminalPlay`; this fix only reads two already-available values
at one existing call site.

### Fix rationale

Additive: a new optional suffix, rendered only when both inputs are finite/usable, never fabricated
on a null/unsynced mark or a rung with no entry basis to price. Per the Largo product contract's
precision principle — a real, already-computed dollar figure is more actionable than a
percent-from-entry figure alone once a position carries an unrealized gain, and showing both
(rather than replacing one with the other) keeps the existing framing intact for a member who wants
either view.

### Verification

- Independent re-verification performed from scratch on a fresh branch off actual latest
  `origin/main` (which already includes #5190's merge), not the originating research agent's own
  working-tree state — diff applied cleanly, RED/GREEN reproduced independently, tsc clean, plus an
  additional correctness sanity-check on the `pnlPct`/`premium` same-source-data claim (see above).
- Full suite result to be appended once the background run completes.
