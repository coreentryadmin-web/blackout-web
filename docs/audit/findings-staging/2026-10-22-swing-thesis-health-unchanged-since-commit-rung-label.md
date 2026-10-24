> **kind:** FINDING

## Swing thesis-health `rungLabel` named a process word with no reference to whether anything had actually moved since commit, at 2 renderers beyond play-brief.ts's own fix

| **Status** | FIXED |
|------------|-------|

**Symptom:** `rungFromHealth`/`rungLabel` bands purely off absolute `health` %, never
`delta`/`moves` — "Weakening"/"Degraded"/"Broken" are process words that presuppose decay, but a
position can sit in a low band from commit day one, unchanged, forever, purely from imperfect
entry geometry. `play-brief.ts`'s "Thesis health" section already disambiguated this (2026-10-07,
refined 2026-10-14/16) with a local check — two sibling renderers of the SAME `h.rungLabel` never
got it:
- `holdPlanSection`'s "Thesis health" line (`play-brief-intel.ts`) — also gated a "Tighten risk —
  thesis fading" bullet on bare `health < 45` with no drift check.
- `thesisPillarCoaching` (`play-brief-narrative-coaching.ts`) — could render `"**Thesis Degraded**
  (50%) — Thesis fading — tighten risk or trim into strength"` for a position that, by its own
  `moves` field, had never moved.

**Root cause:** the disambiguation logic (`h.moves?.[0]?.includes("unchanged") &&
!h.materialGivebackSinceCommit`) lived only as a local in `play-brief.ts`, never shared, so the
two later renderers of the same `rungLabel` never inherited it.

**Fix:** extracted the shared predicate `thesisHealthUnchangedSinceCommit` (`thesis-health.ts`);
all three renderers (`play-brief.ts`, `play-brief-intel.ts`, `play-brief-narrative-coaching.ts`)
now call it, so they can never disagree about the same fact again. Both `play-brief-intel.ts` call
sites (the rungLabel line and the "Tighten risk" bullet) and the narrative-coaching advisory
sentence are gated on it.

**Verify:** `thesis-health.test.ts` — new `thesisHealthUnchangedSinceCommit` suite (3 cases:
unchanged/flat default, real pillar fade, fallback sentinel with hidden material giveback).
