> **kind:** FINDING

## Ask Largo — "next trim" distance bullet uses fabricated entry-fallback as a real live mark — FIXED

| | |
|---|---|
| **Area** | `src/lib/swing/play-brief-narrative-coaching.ts` (`manageLifecycleCoaching`) |
| **Status** | FIXED |
| **Severity** | P3 — narrative-quality/self-contradiction gap, no data-correctness impact (no dollar values were wrong, they were mislabeled as known) |
| **Found via** | Ask Largo × Night Hawk Swings standing ownership mandate (`CLAUDE.md`) live deep-dive, `GET /api/market/swing/play-brief?playId=SWING:WOLF&positionId=1218&status=OPEN` |

### Root cause

`horizonPlayFromBangerPosition` (banger-lane-merge.ts) sets `contract.mid = last_mark ?? entry_premium`
— when a banger-lane position has never synced a live quote, `play.mark` IS the entry premium
replayed, not a real observation. The brief's own Position section already knows this exact
signature (`markIsSync === true && pnlPct == null`, centralized as `optionMarkGenuinelyUnknown` in
`play-brief-absence.ts`) and correctly prints `Mark: **unknown** _(sync quote, no live price yet —
do not read as flat)_` for it.

`manageLifecycleCoaching`'s "next trim" distance-to-target bullet (added 2026-09-18, the BASIS
MISMATCH fix that prefers `execMark` over `mark` when BOTH are real quotes) never checked that same
signature — it fell through to `play.mark` whenever `execMark` was absent, with no gate on whether
`play.mark` itself was real. Live-confirmed on WOLF (2026-09-20, real production
`SWING:WOLF:1218` OPEN brief): the "Trade manager read" section read *"next trim at **+100%** —
mark **$0.77**, needs **$1.54** (+100% from here)"* while the Position section, a few lines above in
the SAME envelope, read *"Mark: **unknown** _(sync quote, no live price yet — do not read as flat)_"*.
$0.77 is the entry premium, not a live quote — the bullet computed a confident room% from the exact
number the document says is not known.

This is a fourth instance of the same self-contradiction class already fixed three times at other
call sites (`pnlSection`'s own "Mark" line, 2026-09-11; the "Premium stop rail" cushion,
`play-brief-intel.ts`, 2026-09-12 EBS repro; the "Premium target rail" room%, same file) — all three
import and gate on `optionMarkGenuinelyUnknown`; this fourth site did not.

### Blast radius

Single function (`manageLifecycleCoaching`), single branch (the not-yet-crossed "next trim"
distance disclosure) — the only call site in the coaching file that derives a room% from
`play.mark`/`play.execMark` without the shared guard. The 2026-09-18 BASIS MISMATCH fix in the same
branch is untouched (still prefers `execMark` when both marks are real).

### Fix

Import `optionMarkGenuinelyUnknown` from `play-brief-absence.ts` and gate the whole `distanceSuffix`
render on `!optionMarkGenuinelyUnknown(play)`. When the mark is the true entry-fallback echo, the
bullet now reads `next trim at **+100%**` with no fabricated dollar-distance clause — honest about
not knowing, matching the Position section a few lines above instead of contradicting it.

### Fix rationale

Reuses the exact shared helper every sibling call site already uses rather than re-deriving a fifth
ad-hoc check (the same anti-drift discipline `optionMarkGenuinelyUnknown`'s own doc comment calls
out). Does not touch the true-basis-mismatch fix (execMark vs mid) for the case where a real quote
exists — only suppresses the whole disclosure when NEITHER basis is real.

### Tests

`src/lib/swing/play-brief-narrative-coaching.test.ts`: new test
`manageLifecycleCoaching: 'next trim' distance disclosure is suppressed when mark is the true
entry-fallback echo (not a real quote)` — builds a play with `pnlPct: null`, `markIsSync: true`,
`mark: 0.77` (== entry), `execMark: null`, asserts the "next trim at +100%" clause still renders but
no "mark $0.77"/"bid $0.77"/"from here" text appears. RED→GREEN verified directly (test failed
against pre-fix source with the exact live WOLF string, passed after the fix). Full
`play-brief*.test.ts` suite (699 tests) + `tsc --noEmit` green on Node 20.

### Market-open validation

See `docs/audit/MARKET-OPEN-VALIDATION.md` — check a live committed swing position from the
banger lane that has never synced a live option quote (Position section reads "Mark: unknown") and
confirm its "Trade manager read" no longer states a specific "mark $X, needs $Y" distance for the
next trim rung.
