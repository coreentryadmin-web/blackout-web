# Night Hawk Swings closed play-brief self-contradicts on trim mechanism — FIXED

> **kind:** FINDING

## Symptom
Live CLOSED swing play-brief for `SWING:MRNA:68` (fetched fresh, 2026-11-07 ~14:36 ET, Ask Largo
standing mandate 5-engine deep-dive) contains a genuine, reproducible self-contradiction between
its "Trade manager read" section and its "Lessons" section, for the SAME play:
- **Trade manager read** (`closedCoaching()`, `src/lib/swing/play-brief-narrative-coaching.ts`):
  "**Strong discipline** — captured **~100%** of peak; replicate trim timing."
- **Lessons** (`lessonsSection()`, `src/lib/swing/play-brief-intel.ts`): "Closed positive, but the
  scale-out ladder's own +100% trigger is not confirmed to have fired — review how this actually
  exited (manual close, time-stop, or thesis-break) before crediting the mechanism."

Both sections read the same play record (`closedReason: "target"`, `trimEnforcedBeforeClose:
false`) and reach opposite verdicts on whether the scale-out ladder actually fired.

## Root Cause
`closedCoaching()`'s MFE-capture branch computed `capture` purely from `mfeCaptureOutcome(exitPnlPct,
peak, mfeCapturePct)` — a function of realized P&L and peak alone — and credited "**Strong
discipline** ... replicate trim timing" whenever `capture >= 75`, with **no reference to whether
the scale-out ladder's own +100% trigger ever actually armed**.

`TerminalPlay.trimEnforcedBeforeClose` is the one frozen-at-grade-time fact that distinguishes a
genuine ladder-triggered exit from a manual/time-stop/thesis-break exit that happened to close
green with a high capture% — `closedReasonFromRow` derives `closedReason` purely from the sign of
`realized_pnl_pct`, so a manual close taken while still green lands on `"target"` identically to a
real ladder exit.

This exact gap was already found and fixed once in the sibling `lessonsSection()` function
(`play-brief-intel.ts`, 2026-11-01, live repro PANW:67) via a `mechanismConfirmed =
play.trimEnforcedBeforeClose === true` gate — but that fix landed only in `lessonsSection`, not in
`closedCoaching`, leaving the exact same unconditional-mechanism-credit bug live in the sibling
section. Same failure shape CLAUDE.md already documents for this codebase: one bug, two
near-identical call sites, one gets the fix.

## Fix
Added the identical `trimEnforcedBeforeClose === true` gate to `closedCoaching()`'s `capture >= 75`
branch: the "Strong discipline ... replicate trim timing" line now requires both a high capture AND
a confirmed ladder exit. When capture is high but the mechanism isn't confirmed, the section now
says so honestly ("Captured X% of peak, but the scale-out ladder isn't confirmed to have fired —
review how this actually exited before crediting trim discipline") instead of crediting discipline
that may not have been exercised.

## Blast Radius
- `src/lib/swing/play-brief-narrative-coaching.ts` — `closedCoaching()`'s capture>=75 branch gated.
- `src/lib/swing/play-brief-intel.ts` — unaffected; already correct (the reference pattern copied).
- No other call site of `closedCoaching` needed changes.

## Evidence
- Live repro (pre-fix): `GET /api/market/swing/play-brief` for `SWING:MRNA:68` — Trade manager read
  says "Strong discipline ... replicate trim timing"; Lessons says the mechanism isn't confirmed.
  Same `trimEnforcedBeforeClose: false` record, opposite verdicts.
- `npx tsc --noEmit` clean after the change.
- Two new regression tests in `play-brief-narrative-coaching.test.ts` pin both sides of the gate
  (confirmed ladder exit still gets credit; unconfirmed does not) — both pass post-fix.
- Full `src/lib/swing/*.test.ts` suite: 2236/2236 pass (33 suites), Node 20.

## Fix rationale
Copied `lessonsSection`'s exact `mechanismConfirmed` pattern rather than inventing a new phrasing,
since the two sections already need to agree on this fact for the same play — diverging wording for
an identical gate would just be a second place to keep in sync. Left `lessonsSection` itself
untouched; it was already correct and is the reference this fix mirrors.

| **Status** | Fixed in PR (this commit) |
