> **kind:** FINDING

## Ask Largo swing play-brief: every OPEN Banger-origin R:R-to-level number was fed to Largo's answer-engine with zero disclosure that its stop is a live-recomputed guess, not the real position — FIXED

**Status:** Fixed, regression tests added (`src/lib/swing/play-brief-adapter.test.ts`).

### Root cause

`extractEvidence()` (`src/lib/swing/play-brief-adapter.ts`) feeds Largo's `evidence_numbers`
contract field from, among other sources, every favorable-side `structureLadder` rung's own
reward:risk ratio (`rung.target.rewardRisk`, shipped by PR #6790): `"R:R to ${label} ($price):
${rr}R"`. That ratio is computed by `buildStructureLadder` (`play-brief-ladder.ts`) against
`structureLadder.stop` — which is the REAL, entry-pinned invalidation level
(`play.invalidationUnderlyingPx`) only when `useRealPlan` is true, and `useRealPlan` requires BOTH
`play.entryTriggerUnderlyingPx` and `play.invalidationUnderlyingPx` to be non-null
(`play-brief-ladder.ts:367-375`).

For every Banger-origin OPEN swing position, neither field is ever populated:
`horizonPlayFromBangerPosition` (`src/lib/swing/banger-lane-merge.ts`, the function that maps an
open `banger_positions` row into a swing `HorizonPlay`) never sets
`entryTriggerUnderlyingPx`/`invalidationUnderlyingPx` on the object it returns (confirmed by
reading its full return block — the keys are simply absent, so they resolve to `undefined` on the
resulting `TerminalPlay`, and `undefined != null` is `false`). `useRealPlan` is therefore always
`false` for this lane, and `structureLadder.stop` silently falls back to
`deriveSwingPlanLevels(direction, spot, null)` (`structure-levels.ts`) — a context-free heuristic
anchored to **today's live spot** (`entryUnderlyingPx := price`, ATR proxy `:= price × 1.5%`, stop
`:= spot ∓ 1.5×ATR`), re-derived fresh on every request, carrying no relationship to the position's
actual entry or risk.

`BieStructureLadder.tsx` (the UI widget rendering this exact same R:R number) already discloses
this precisely: it reads `ladder.stopIsCommitted`/`ladder.positionState` and, whenever
`positionState === "open" && !stopIsCommitted`, renders "Reference stop ... Recomputed from
today's spot — this position's own committed invalidation level (set at entry) may differ"
right next to the R:R chip (a fix shipped 2026-09-12 per `FINDINGS.md`). `extractEvidence()`'s R:R
loop — added later (2026-10-26, PR #6790) specifically to surface this same number into
`evidence_numbers` for Largo's answer-engine context — copied only `rung.target.rewardRisk` into
the plain-text string, never the sibling `stopIsCommitted`/`positionState` fields the UI reads for
its disclosure. Largo's answer-engine reads `evidence_numbers`, not the rendered widget, so it was
citing a basis-less, order-of-magnitude-off R:R with no caveat whatsoever.

### Evidence

- Source-confirmed against current `main`: `banger-lane-merge.ts`'s `horizonPlayFromBangerPosition`
  return object (lines ~147-280) has no `entryTriggerUnderlyingPx`/`invalidationUnderlyingPx` keys
  at all; `HorizonPlay`/`TerminalPlay` both declare them `?: number | null` (optional), so the
  absence resolves to `undefined`, which fails `useRealPlan`'s `!= null` checks in
  `play-brief-ladder.ts:367-375`.
- `structure-levels.ts:39-63`'s `deriveSwingPlanLevels` confirmed to compute exactly the
  price-anchored heuristic described above (`atr = price * 0.015`, `stopDist = 1.5 * atr`,
  `entryUnderlyingPx = price` i.e. today's spot — not any stored entry).
- `BieStructureLadder.tsx:195-213` confirmed to carry the exact UI-side disclosure, gated on
  `ladder.positionState === "open" && !ladder.stopIsCommitted`.
- `play-brief-adapter.test.ts`'s existing fixture at the R:R-evidence test explicitly sets
  `stopIsCommitted: false` but never asserted a caveat should accompany the line for the OPEN case
  — confirmed unguarded before this fix.
- **RED (before the fix):** new test `"adaptSwingBriefToLargo: an OPEN position's R:R evidence
  discloses an uncommitted (live-spot-recomputed) reference stop"` failed —
  `evidence` contained the bare `"R:R to call wall ($110.00): 2.0R"` with no caveat text.
- **GREEN (after the fix):** same test passes; a second new test confirms a genuinely COMMITTED
  OPEN stop (`stopIsCommitted: true`) still gets the bare line with no caveat (honest — that case
  really is the real, entry-pinned invalidation level, so no disclosure is warranted).
- Full `play-brief-adapter.test.ts` suite: 14/14 pass. Broader sibling suites
  (`play-brief-ladder.test.ts`, `play-brief.test.ts`, `play-brief-intel.test.ts`,
  `answer-envelope.test.ts`): 571/571 pass, no regression.
- `npx tsc --noEmit`: clean. `npx eslint` on both touched files: 0 errors/warnings.

### Blast radius

Single function: `extractEvidence()` in `src/lib/swing/play-brief-adapter.ts`. This is the only
place `structureLadder` rungs' R:R ratios reach Largo's `evidence_numbers`; the markdown narrative
never mentions "R:R" at all (this basis-less number reached only the structured contract field, not
prose), and the UI widget was already correct and untouched. No other reader of `structureLadder`
needed a change.

### Fix rationale

Mirror the UI's own disclosure condition exactly (`positionState === "open" && !stopIsCommitted`)
rather than inventing a new rule: a WATCH candidate's stop is honestly "structural" (there is no
committed entry to compare against in the first place, so the live-spot recompute IS the correct
and only basis), and gets no caveat, matching the widget. A genuinely committed OPEN stop
(real per-position data) also stays bare — a caveat there would be dishonest in the opposite
direction. Only the OPEN+uncommitted case — which is every Banger-origin OPEN position today —
gets the appended caveat, directly inside the evidence string itself (rather than as a separate
array entry) so each line stays self-contained for a reader that may not cross-reference other
array entries.

### Deliberately left unchanged

- `horizonPlayFromBangerPosition`/`banger-lane-merge.ts` — not touched. Wiring real
  `entryTriggerUnderlyingPx`/`invalidationUnderlyingPx` onto Banger-origin positions (the deeper
  fix that would let `useRealPlan` actually fire for this lane) is a materially larger change —
  `banger_positions` would need genuine entry/stop fields threaded through from wherever the
  position was opened, not just a disclosure fix — and is out of scope here; this PR makes the
  existing honest-disclosure contract Largo already has for the UI reach Largo's own
  answer-engine context too, the same scope the original #6790 PR had.
- `deriveSwingPlanLevels`/`structure-levels.ts` — the heuristic itself is a legitimate,
  documented fallback (its own header: "a grounded price-relative proxy, not a fabricated absolute
  level") for when no real plan exists; the bug was the missing disclosure downstream, not the
  heuristic's existence.
- `BieStructureLadder.tsx` — already correct; used only as the reference pattern this fix mirrors.
