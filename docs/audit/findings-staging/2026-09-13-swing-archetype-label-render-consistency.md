> **kind:** FINDING

## Ask Largo swing play-brief rendered the same archetype value THREE different ways in one document — FIXED

| **Status** | FIXED |
|---|---|

### Root cause

Live production repro (`GET /api/market/swing/play-brief?playId=SWING:COIN`, WATCH-bucket,
2026-09-13, PULLBACK_CONTINUATION archetype): a single member-facing document rendered the
identical underlying archetype value three visibly different ways:

- **Verdict** section: `Archetype: PULLBACK_CONTINUATION` — the raw enum, untouched
  (`play-brief.ts`: `` `Archetype: ${play.archetype}` ``).
- **Why this setup** section, its own Archetype line: `**Archetype:** PULLBACK CONTINUATION` —
  underscores blindly replaced with spaces but not cased
  (`play-brief-intel.ts`: `` `**Archetype:** ${play.archetype.replace(/_/g, " ")}` ``).
- The SAME section's Discovery-read line and the Trade-manager read's Cross-desk-friction line:
  `Pullback continuation` — the correct, already-humanized `ARCHETYPE_META[archetype].label`.

Three different transforms of one field, visible within seconds of each other in the same
document — a genuine narrative-polish defect (not a wrong-data bug: the underlying archetype was
correctly identified in all three places), exactly the kind of "narrative could read more like a
trade manager and less like a bullet dump" gap the standing Ask Largo mandate asks to hunt for.

### Fix

Added `archetypeLabelFromRaw(raw: string | null | undefined): string | null` to `taxonomy.ts` —
the single shared, safe narrowing of `TerminalPlay.archetype` (typed loosely as `string | null`,
since `TerminalPlay` is shared across 0DTE/Legacy/Swing) down to the canonical
`ARCHETYPE_META[...].label`, returning `null` for anything that isn't one of the 8 real
`SwingArchetype` values (honest-absence, matching this repo's standing discipline — never guess a
label for an unclassifiable value). Wired it into both remaining ad hoc call sites:

- `play-brief.ts`'s Verdict line now reads `Archetype: Pullback continuation`.
- `play-brief-intel.ts`'s Why-this-setup Archetype line now reads
  `**Archetype:** Pullback continuation`.

All three render sites in a brief now show the identical, correctly-humanized label.

### Blast radius

Two call sites fixed (`play-brief.ts`, `play-brief-intel.ts`); the Discovery-read/Cross-desk-friction
lines already used the correct label and are untouched. `subLane` rendering
(`play.subLane.replace(/_/g, " ")`) was deliberately left alone — real `SwingSubLane` values
(`TACTICAL`/`STANDARD`/`EXTENDED`) have no underscores, so that transform is currently a no-op and
does not exhibit this defect; giving it its own canonical-label treatment is a separate, smaller
follow-up if ever needed, not bundled into this fix (ship less but correct).

### Fix rationale

Considered instead just fixing `play-brief-intel.ts`'s own transform to also title-case (matching
neither Verdict's raw enum nor the canonical label) — rejected: that would still leave THREE
distinct renderings, just changing which two disagree. The only fix that actually converges the
whole document on one presentation is routing every call site through the same canonical
`ARCHETYPE_META` label already used correctly elsewhere in the brief.

### Evidence of testing

- New unit test in `taxonomy.test.ts`: every real `SwingArchetype` maps to its own
  `ARCHETYPE_META[...].label`; `null`/`undefined`/empty/foreign/lowercased strings all return `null`.
- New test in `play-brief.test.ts`: Verdict's Archetype line now reads
  `Archetype: Pullback continuation`, never the raw `PULLBACK_CONTINUATION` enum.
- New test in `play-brief-intel.test.ts`: Why-this-setup's Archetype line uses the canonical label
  for a real archetype and renders nothing for a foreign/unclassifiable value (previously it would
  have blindly humanized any non-empty string).
- Updated an existing `play-brief-intel.test.ts` test that had been using a fabricated
  `"momentum_breakout"` fixture value (never a real production archetype — `TerminalPlay.archetype`
  is populated only from `classifyArchetype`'s own `SwingArchetype` union or `null`) to a real
  archetype (`"BREAKOUT"`), preserving the test's actual intent (archetype + subLane both render
  together) while aligning it with the corrected, honest-narrowing behavior.
- RED confirmed: reverting only the three source-file changes (keeping the new/updated tests)
  reproduced exactly 3 failures.
- GREEN: fix restored, 177/177 pass across `taxonomy.test.ts` + `play-brief.test.ts` +
  `play-brief-intel.test.ts`.
- `npx tsc --noEmit`: clean.
- Full `npm test` (Node 20.20.2): see PR for final count.

Found during the Night Hawk Swings standing aggressive-mode improvement-hunt mandate, live COIN
WATCH-bucket play-brief pull, 2026-09-13. Small, swing-lane-local, purely a display-consistency fix
with no scoring/gating/data-correctness impact — no cross-desk sign-off needed under the standing
CARVE-OUT discipline.
