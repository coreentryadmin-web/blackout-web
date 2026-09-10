# Legacy play thesis silently drops the gap's own directional explanation — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **ID** | BO-P3-legacy-thesis-gap-fill-truncation |
| **Pri** | P3 (narrative quality) |
| **Area** | Night Hawk Legacy — deterministic thesis generation |
| **Status** | FIXED |

## Symptom

Live 2026-09-10 edition, FICO (SHORT, conviction A): the member-facing thesis read *"FICO
showing prior day HOD break, gap up 49.89 in bearish trend."* — a stock breaking its own prior
high and gapping up are both classically bullish continuation facts, shown with no stated reason
a member should read them as support for a SHORT. Found during this session's own "aggressive
improvement-hunting" pass (the standing brief explicitly names "a picks narrative that could be
richer" as an example to look for), not a member complaint.

## Root cause

`classifySetup()` (`technicals.ts`) already computes exactly the missing connective reasoning:
whenever `|price - priorClose| > 0.5×ATR` it pushes a `"gap up X"`/`"gap down X"` tag **and**,
immediately after it, a `"gap-fill risk below"` (after a gap up) or `"gap-fill bounce zone
above"` (after a gap down) tag — the one `setup_tag` in the whole list that argues a *direction*
(a gap up creates downside gap-fill risk; a gap down creates upside bounce potential), unlike the
purely descriptive RSI/volume/EMA tags around it.

`buildDeterministicThesis()` (`deterministic-edition.ts`) throws that reasoning away: its opener
sentence takes `setupTags.slice(0, 2)` unconditionally. For FICO, `"prior day HOD break"` and
`"gap up 49.89"` filled both slots (in that push order), so `"gap-fill risk below"` — 3rd in the
array — never reached the sentence, even though it was the one tag that actually explains why a
gap-up, HOD-breaking stock is being shorted (dealer/flow read says the gap gets sold into).

This is the same *shape* of gap the existing `trendConflicts` check (PR-N28) already patches for
the aggregate `trend` field vs. direction — but that check only looks at the overall trend label,
not at individual `setup_tags` whose own polarity can conflict with the play direction while the
aggregate trend still agrees with it (FICO's `trend` was already `"bearish"`, matching the SHORT,
so `trendConflicts` was correctly `false` — the confusion lived one level down, in the tag list).

## Fix

In `buildDeterministicThesis`, when the gap tag (`"gap up X"`/`"gap down X"`) is among the first
two selected tags but its own `"gap-fill …"` companion was not, append the companion tag rather
than dropping it. Deliberately narrow: only fires when the gap tag itself was actually selected —
a play whose opener never mentions the gap (two stronger tags precede it) gets no orphaned
gap-fill commentary either, covered by a dedicated negative test.

## Evidence

- RED→GREEN: added `"thesis keeps a gap tag paired with its own gap-fill explanation instead of
  truncating it away"`, built from the exact live FICO tag order, failed pre-fix
  (`actual: '...gap up 49.89 in bearish trend...'`, no `gap-fill` substring) and passes post-fix.
  A companion negative test (`"...does not force in a gap-fill tag when the gap tag itself was
  never selected"`) guards against over-eager insertion.
- Full `deterministic-edition.test.ts`: 43/43 pass. Full Night Hawk suite
  (`find src/features/nighthawk -name "*.test.ts"`, `--experimental-test-module-mocks`):
  1360/1360 pass.
- `npx tsc --noEmit -p .`: clean. `npx eslint` on both changed files: clean.

## Blast radius

Single call site (`buildDeterministicThesis`); no other consumer reads `setup_tags` for its own
truncated slice. Every desk that surfaces Legacy's deterministic thesis (member edition API, the
Legacy detail panel, Largo's `get_nighthawk_edition`/dossier tools) inherits the fix automatically
since they all read the same `thesis` string off the built play — nothing else to touch.
