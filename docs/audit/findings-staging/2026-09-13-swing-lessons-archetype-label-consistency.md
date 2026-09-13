> **kind:** FINDING

## Ask Largo CLOSED-play "Lessons" section rendered the archetype label raw, unlike the rest of the same brief — FIXED

| **Status** | FIXED |
|---|---|

### Root cause

Live production repro (`GET /api/market/swing/play-brief?playId=SWING:EWZ:29`, CLOSED, PULLBACK_CONTINUATION
archetype): earlier this session, PR #4896 fixed the identical archetype value rendering three
different ways in one brief (Verdict's raw enum, Why-this-setup's underscore-replace-only line, and
the correct humanized `ARCHETYPE_META` label elsewhere) by routing `play-brief.ts`'s Verdict line and
`play-brief-intel.ts`'s `whyThisSetupSection` through a new shared helper, `archetypeLabelFromRaw`.

A third call site with the identical defect was missed in that pass: `play-brief-intel.ts`'s
`lessonsSection` (the CLOSED-bucket post-mortem/"Lessons" section) still had its own inline
`play.archetype.replace(/_/g, " ")` transform. Live EWZ:29 confirms the resulting inconsistency
persisted inside a SINGLE brief even after #4896 shipped:

- Verdict: `Archetype: Pullback continuation` (fixed, humanized).
- Why this setup: `**Archetype:** Pullback continuation` (fixed, humanized).
- **Lessons**: `Archetype **PULLBACK CONTINUATION** — tag this outcome in your playbook review.`
  (still the raw underscore-replaced, uncased form).

### Fix

`lessonsSection` now calls the same `archetypeLabelFromRaw` helper #4896 already introduced in
`taxonomy.ts`, instead of its own inline `replace(/_/g, " ")`. All three render sites in a CLOSED
play's brief now agree.

### Blast radius

Single call site (`lessonsSection`, `play-brief-intel.ts`). No other archetype-rendering call sites
remain — grepped the file for `.archetype.replace(` (now zero matches) and for any other direct
archetype interpolation outside the three already-fixed sites.

### Fix rationale

Same as #4896: route every archetype-display call site through the one canonical label lookup
rather than patching each inline transform individually — the actual bug class is "N independent
inline transforms of the same enum," and the fix is eliminating the last of them, not adding a
fourth slightly-different one.

### Evidence of testing

- New test in `play-brief-intel.test.ts`: `lessonsSection`'s Archetype tag reads
  `Archetype **Pullback continuation**` for a real archetype, never the raw
  `PULLBACK_CONTINUATION`/`PULLBACK CONTINUATION` forms.
- An existing test (`lessonsSection: omits the round-trip sentence...`) already asserted
  `/pullback continuation/i` case-insensitively and continues to pass unchanged — this fix only
  changes casing/spacing, not content.
- RED confirmed: reverting only the source change (keeping the new test) reproduced the failure.
- GREEN: fix restored, 117/117 pass in `play-brief-intel.test.ts` (116 pre-existing + 1 new).
- `npx tsc --noEmit`: clean.
- Full `npm test` (Node 20.20.2): see PR for final count.

Found during the Night Hawk Swings standing aggressive-mode improvement-hunt mandate, live EWZ:29
CLOSED-play play-brief pull, 2026-09-13 — the first CLOSED-bucket brief examined this session (the
prior audit passes this session focused on WATCH/OPEN buckets). Small, swing-lane-local, purely a
display-consistency fix with no scoring/gating/data-correctness impact — no cross-desk sign-off
needed under the standing CARVE-OUT discipline.
