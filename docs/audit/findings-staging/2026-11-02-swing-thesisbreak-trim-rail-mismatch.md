> **kind:** FINDING

## Swing `thesisBreakCoaching`'s "warn" bullet names a nonexistent "next trim rail" for TRIM-status positions — sibling of #7380, FIXED

| **Status** | FIXED (`fix/swing-thesisbreak-trim-rail-mismatch`) |
|---|---|

### Root cause

Found during a live-check of #7380 (the "4-engine live monitor" + Ask Largo standing mandate's
own verification pass over `GET /api/market/nighthawk/horizons?view=swings` and
`GET /api/market/swing/record`). #7380 fixed the exact bug class in `crossDeskResolution` — a
TRIM-status position being told to wait for a "next trim rail" when `SWING_SCALE_OUT_POLICY`
(`src/lib/swing/exit-policy.ts`) has exactly **one** trim rung, so once `status === "TRIM"` that
rung has already fired and only the trailing runner stop on the remaining `runner_fraction` is
left. `src/lib/swing/play-brief-narrative-coaching.ts`'s sibling function `thesisBreakCoaching()`
has the identical defect, in a different call site #7380 never touched:

```ts
export function thesisBreakCoaching(play: TerminalPlay): string | null {
  if (thesisHealthUncalibrated(play.thesisHealth)) return null;
  const level = play.thesisBreak?.level ?? play.thesisHealth?.thesisBreakLevel;
  const note = play.thesisBreak?.note ?? play.thesisHealth?.thesisBreakNote;
  if (!level || level === "unknown" || level === "intact") return null;

  if (level === "break") {
    return `**Thesis BREAK** — ...`;
  }
  return `**Thesis WARN** — ${note ?? "pillars fading"}. Tighten stops; next trim rail is your friend.`;
}
```

The `"warn"` branch (`thesisHealth.thesisBreakLevel` lands in the 45-69 health band, or the raw
`play.thesisBreak.level` input says `"warn"` directly) names "your next trim rail" unconditionally,
with no reference to `play.status` at all — unlike `crossDeskResolution`, which #7380 now
correctly branches on `status === "TRIM"` ("runner" bucket) vs `OPEN`/`HOLD` ("open" bucket). The
pre-existing `thesisHealthUncalibrated()` guard at the top of the function is a *different* check
(BO-P1-LARGO-002, 2026-09-xx — withholds the bullet when the pillar labels are generic-default
sentinels, i.e. the score itself isn't real) and does nothing to protect against this: a fully
**calibrated** `thesisHealth` (every pillar carries a real, position-specific label) landing in
the warn band on a `TRIM`-status position still hits this exact wording.

### Evidence

No live TRIM-status position carried a calibrated `thesisHealth` at audit time (2026-11-02) — the
board's 11 live TRIM rows are all Banger-origin, where `thesisHealth` is withheld entirely
("Inputs not wired for committed positions"), so this specific text was not visibly wrong on the
production board *today*. Confirmed the defect is real and reachable with a direct repro against
the live, unmodified source (`node --import tsx`, imported `thesisBreakCoaching` from the real
file, no reimplementation):

```
play: { status: "TRIM", thesisHealth: { health: 55 /* warn band */, thesisBreakLevel: "warn",
  pillars: [ ...real, non-sentinel labels... ] } }

RENDERED BULLET: "**Thesis WARN** — pillars fading. Tighten stops; next trim rail is your friend."
```

Any native (non-Banger) swing position whose trim fires (status flips to `TRIM`) while its thesis
pillars continue to drift into the warn/break band reaches this branch — a very plausible sequence
(trim fires on a profit milestone; theta/regime decay is independent of that milestone and often
continues afterward). This is the same contradiction #7380's own live repro (TXRH) demonstrated for
`crossDeskResolution`, just not yet observed live for this sibling function because today's live
TRIM population happens to be 100% Banger-origin (thesisHealth-withheld).

Regression test (`src/lib/swing/play-brief-narrative-coaching.test.ts`, two new tests:
`"thesisBreakCoaching: TRIM status names the trailing stop, not a nonexistent next trim rail
(sibling of #7380)"` and `"thesisBreakCoaching: OPEN/HOLD status keeps the forward-looking 'next
trim rail' wording (rail is still ahead)"`). RED before the fix (`git stash` the source file alone
— 202/203 pass, the new TRIM test failing on the unfixed unconditional text). GREEN after
(203/203). `npx tsc --noEmit` clean. `src/lib/swing/play-brief.test.ts` +
`play-brief-intel.test.ts` + `thesis-health.test.ts` together: 582/582 pass (no consumer of
`thesisBreakCoaching`'s output regressed).

### Blast radius

Single function (`thesisBreakCoaching`), single call site (`collectCoachingBullets`, unconditional
for every OPEN/HOLD/TRIM/WATCH bucket — never "closed"). Only the `"warn"` level's text referenced
trim mechanics; the `"break"` branch ("Exit or cut to runner only; don't add size.") already reads
correctly for any status and was left untouched.

### Fix rationale

Mirrors #7380's own fix exactly rather than inventing new wording: the `"warn"` branch now checks
`play.status === "TRIM"` and renders "Tighten stops; the trailing stop is your friend." in that
case, keeping the original "Tighten stops; next trim rail is your friend." for every other reachable
status (`OPEN`/`HOLD`, where a real rail genuinely is still ahead). No other behavior changed.
