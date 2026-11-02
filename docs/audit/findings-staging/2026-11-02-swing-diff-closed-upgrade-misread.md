> **kind:** FINDING

## Ask Largo swing "What changed" diff narrates a stopped-out/closed position as a desk "upgrade" to HOLD — FIXED

**Status:** FIXED (`fix/swing-diff-closed-upgrade-misread`)

### Root cause

`src/lib/swing/play-brief-diff.ts`'s `RECOMMENDATION_RANK = { BUY: 3, HOLD: 2, TRIM: 1, SELL: 0 }`
ranks `HOLD` above both `TRIM` and `SELL`. `managementFor()`'s already-fixed CLOSED branch
(`src/features/nighthawk/command-deck/adapters.ts:181`, from `2026-11-01-managementfor-closed-
no-op.md`) now deterministically stamps `recommendation: "HOLD"` on every closed position,
regardless of whether it closed via a profitable TRIM or a losing SELL/stop — a moot sentinel
(`adapters.ts`'s own `recNote` for this value: "Position closed — nothing left to manage."), not
a live management decision.

That prior fix addressed the *static* display value but never looked at how the new,
unconditional HOLD sentinel interacts with the live "What changed"/SSE-pulse diff engine
(`diffBriefSnapshots`, `recommendationShiftKind`, `synthesizePnlAndUpgrade`): because HOLD
outranks both TRIM and SELL, every OPEN→CLOSED transition reads as an "upgrade." When the last
two P&L readings also tick upward at/just before a close — common right at a stop that ticks
slightly off its worst print, or a profitable close that ran past the last-seen mark — the live
pulse fires `synthesizePnlAndUpgrade`, narrating the close as "...and the desk upgraded — SELL →
HOLD — tracking together" or "...and the desk upgraded — TRIM → HOLD — tracking together."

### Evidence

Found via a five-engine live correctness audit (cycle-70), Ask Largo swing deep-dive. Confirmed
against the real shipped function — ran the actual exported `diffBriefSnapshots`:

```
SELL -> CLOSED (stopped out, pnl ticked up pre-close):
'...P&L building -- -60% -> -58% (+2.0%) since last refresh, and the desk upgraded --
SELL -> HOLD -- tracking together'

TRIM -> CLOSED (closed higher):
'...P&L building -- 99.2% -> 120% (+20.8%) since last refresh, and the desk upgraded --
TRIM -> HOLD -- tracking together'
```

Both are the opposite of informative: there is no live HOLD decision happening — the position
simply closed. Worst case, a member watching a stopped-out loser is told "the desk upgraded" at
the exact moment the real news is "this just stopped out."

Distinct from `2026-11-01-swing-closed-verdict-stale-hold.md` (fixed the static `envelope.headline`/
Verdict rendering, server-side) and `2026-11-01-managementfor-closed-no-op.md` (fixed the
`managementFor()` return value) — this gap is in a third, independent surface (the client-side
live diff engine), and is a side effect the `managementFor` fix introduced: before that fix, a
closed loser's `recommendation` could itself be `"SELL"` (rank 0), which didn't trigger this
misread as reliably; after that fix it's unconditionally `"HOLD"` (rank 2), so the diff engine
now treats every TRIM/SELL→CLOSED transition as an upgrade.

New regression tests (`play-brief-diff.test.ts`) proven RED before the fix / GREEN after, via
`git stash`/`git stash pop` (46/47 → 47/47 pass): one asserting a SELL→CLOSED and a TRIM→CLOSED
transition are never narrated as "desk upgraded," one asserting a genuine OPEN HOLD→BUY upgrade
is still narrated normally (the fix doesn't over-suppress real upgrades).

### Blast radius

Both call sites of `recommendationShiftKind` in `play-brief-diff.ts` share the same root cause
and are fixed identically (the synthesis-rule call site at line ~351, and the upgrade-detection
call site at line ~360). No other consumer of `recommendationShiftKind` exists.

### Fix rationale

Added `nextIsGenuinelyClosed(next)` (true when `next.sectionTitles` includes `"Outcome"` — the
CLOSED-only section `play-brief.ts`'s `safeCompose("Outcome", ...)` adds) and gated
`recommendationShiftKind` on it: when the transition lands on a genuinely closed position, return
`null` (no upgrade/downgrade classification) regardless of the bare rank comparison, the same
approach `play-brief.ts`'s own `swingVerdictVerb` already uses to special-case `status ===
"CLOSED"`. Deliberately left unchanged: the generic "Desk action shifted" fallback bullet (fires
when a recommendation change isn't consumed by a synthesis rule) — a close still shows as a bare
"SELL → HOLD" shift there, which is a lesser, pre-existing framing question the audit didn't flag
as a defect, out of scope for this fix.
