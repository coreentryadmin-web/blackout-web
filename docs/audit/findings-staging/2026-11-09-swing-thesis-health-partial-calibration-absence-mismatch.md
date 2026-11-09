# 2026-11-09 — [FINDING, P2 Night Hawk Swings / Ask Largo] `unavailableSources` named the wrong thesis-health inputs as missing once pillars are rendered individually — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED — this PR |
| **Found by** | Adversarially-verified live 5-engine audit of production, `GET /api/market/swing/play-brief?playId=SWING:MRVL:70&ticker=MRVL&positionId=70` |
| **Scope** | `src/lib/swing/thesis-health.ts`, `src/lib/swing/play-brief-absence.ts` |

## Summary

For a committed (OPEN/HOLD/TRIM) swing position with thesis health PARTIALLY calibrated — some
pillars real, one or more honestly missing — `play-brief-absence.ts`'s
`collectBriefUnavailableSources()` pushed a structured `unavailableSources` entry naming the
WRONG inputs as missing. It named the three inputs that were actually PRESENT
("setup/entry/signal") and never named the one that was actually missing (regime), directly
contradicting the SAME envelope's own narrative "Thesis health" section, which (since PR #5367,
2026-09-21) correctly renders calibrated pillars individually and withholds only the genuinely
missing one.

Live evidence, `GET /api/market/swing/play-brief?playId=SWING:MRVL:70&ticker=MRVL&positionId=70`
(a real committed, non-Banger-origin position):

- The "Thesis health" narrative section correctly read: "Aggregate score withheld — not every
  pillar input is wired for this position yet." followed by FOUR real, calibrated pillar rows with
  non-zero deltas — Persistence, Entry geometry, Signal stack, Theta budget. Only Regime-fit was
  actually missing.
- The SAME envelope's structured `unavailableSources` array still carried:
  ```json
  {
    "source": "thesis health",
    "reason": "setup/entry/signal inputs unavailable for committed positions",
    "what_is_missing": "the setup/entry/signal inputs the thesis-health score is calibrated on",
    "retryable": false
  }
  ```
  — doubly wrong: it named exactly the three inputs that WERE present and shown with real deltas,
  while never naming the one (regime) that was ACTUALLY missing.
- This also fed `confidence.why` ("11 sources unavailable this cycle (... thesis health) —
  evidence base is thin, treat with extra caution"), so Largo's own grounding/confidence reasoning
  inherited the wrong claim.

Confirmed this is specifically the PARTIAL-calibration case that's broken: a fully-calibrated
position (e.g. PLTR/GOOG) correctly does not carry a `thesis health` entry in `unavailableSources`
at all; a fully-uncalibrated Banger-origin position (e.g. LABD/CAVA, which has no real per-position
dossier by design) correctly gets the flat "Inputs not wired" body + this same `unavailableSources`
entry, and the two stay accurate together there. Only the partial case disagreed.

## Root cause

`collectBriefUnavailableSources()` (`play-brief-absence.ts`, ~line 1558) gated purely on the
boolean `thesisHealthUncalibrated(ctx.play.thesisHealth)` (`thesis-health.ts`) — an OR across all
5 pillars (persistence/entry_geometry/flow_corroboration/regime/theta_budget), correctly, by
design: the blended AGGREGATE score genuinely can't be trusted if even one input is a generic
default. On `true`, it pushed exactly ONE fixed-text entry naming "setup/entry/signal" — the
specific three inputs the ORIGINAL bug this check was built for (#4318, 2026-09-15/16: setup/
entry/signal structurally null for EVERY committed position at the time) actually involved. This
file does not import `calibratedThesisPillars` at all — it structurally had no way to know WHICH
pillar(s) were actually missing for a given position; it could only say "uncalibrated or not" as
an all-or-nothing boolean, then guess the specific wording from the original bug shape.

That guess stopped being safe on 2026-09-21 (PR #5367, "show real thesis-health pillars instead of
hiding the whole panel when only one is uncalibrated"): the NARRATIVE side
(`play-brief.ts`'s `thesisHealthSection`, via the new `calibratedThesisPillars()`) was changed to
render genuinely-calibrated pillars INDIVIDUALLY with real deltas, withholding only the blended
aggregate %. That PR touched ONLY `play-brief.ts`/`thesis-health.ts` — it never touched
`play-brief-absence.ts`'s reason string, so the two surfaces have silently contradicted each
other on any position missing exactly one (but not all) pillar ever since (confirmed via
`git log -S "setup/entry/signal inputs unavailable for committed positions" --
src/lib/swing/play-brief-absence.ts`: last touched by #4318, never reconciled with #5367).

## Fix

Added `uncalibratedThesisPillars(h)` to `thesis-health.ts` — the exact complement of the existing
`calibratedThesisPillars(h)` (reuses its output by reference via a `Set`, so it can never drift
from what the narrative side already considers calibrated):

```ts
export function uncalibratedThesisPillars(h: ThesisHealthPayload): ThesisPillarState[] {
  const calibrated = new Set(calibratedThesisPillars(h));
  return h.pillars.filter((p) => !calibrated.has(p));
}
```

`collectBriefUnavailableSources()` now calls it to build the `reason`/`what_is_missing` text from
the REAL missing pillar label(s) (lowercased, comma-joined — the same convention
`play-brief-confidence.ts`'s sibling `unavailableSources.map(s => s.source).join(", ")` and
`legacy-calibration/gates-pr5.ts`'s `missing.join(", ")` already use elsewhere in this codebase),
instead of the fixed three-input guess:

```ts
const missing = uncalibratedThesisPillars(ctx.play.thesisHealth);
const allMissing = missing.length === 0 || missing.length === ctx.play.thesisHealth.pillars.length;
const names = missing.map((p) => p.label.toLowerCase()).join(", ");
const plural = missing.length === 1 ? "" : "s";
// reason: allMissing ? "setup/entry/signal inputs unavailable for committed positions"
//                     : `${names} input${plural} unavailable for this committed position`
```

For the live MRVL shape (only `regime` missing), this now reads: `reason: "regime fit input
unavailable for this committed position"`, `what_is_missing: "the regime fit input the
thesis-health score is calibrated on"` — naming exactly the one pillar that's actually missing,
and none of the four that are present.

### Kept unchanged by design

- **All-pillars-uncalibrated case** (`missing.length === h.pillars.length` — the original #4318
  shape, including a Banger-origin row, whose `calibratedThesisPillars` all-or-nothing carve-out
  returns `[]` for every pillar at once): keeps the exact original generic text. Spelling out all
  five pillar labels individually for this case would read as noise for something the existing
  text already describes accurately, and the task's own spec asked to preserve this case byte-for-
  byte.
- **Fully-calibrated case**: `thesisHealthUncalibrated()` returns `false`, so the outer `if` never
  fires and no `thesis health` entry is pushed at all — unchanged.
- **`missing.length === 0` guard**: defensive only. By construction, `thesisHealthUncalibrated()`
  and `calibratedThesisPillars()`/`uncalibratedThesisPillars()` read from the identical underlying
  `UNCALIBRATED_PILLAR_LABELS`/`UNCALIBRATED_MAPPED_LABELS` map, so this branch should be
  unreachable whenever the outer `if` is true — kept as a safety net against the two ever
  disagreeing in some future edge case, falling back to the original generic text rather than
  rendering an empty pillar-name list.

## Blast radius

- `play-brief-absence.ts`'s `collectBriefUnavailableSources()` — the direct fix.
- `play-brief-confidence.ts`'s `confidence.why` line, which reads `unavailableSources.map(s =>
  s.source)` (the `source` field, unchanged — still `"thesis health"`) rather than `reason`/
  `what_is_missing`, so it is unaffected in SHAPE, but now composes from a correct underlying
  claim instead of a wrong one.
- No other call site reads this exact `reason`/`what_is_missing` string pair — confirmed by grep
  (`setup/entry/signal` appears in `play-brief-narrative.ts`/`play-brief-pillar-guard.test.ts`/
  `adapters.ts`/`terminal-display.ts`, but none of those read `unavailableSources`' structured
  text; they independently narrate the pillar-default sentinels themselves).
- `play-brief.ts`'s `thesisHealthSection` (the narrative side) is untouched — it already had the
  correct per-pillar behavior since #5367; this fix brings the structured-absence side into
  agreement with it, not the reverse.

## Evidence (RED → GREEN)

RED (pre-fix, via a plain file-copy backup/restore of `play-brief-absence.ts` to its pre-fix
content — not `git stash`, per this repo's shared-stash-risk note): the new partial-calibration
test fails exactly as expected, showing the old wrong generic text:

```
Expected values to be strictly equal:
+ actual - expected

+ 'setup/entry/signal inputs unavailable for committed positions'
- 'regime fit input unavailable for this committed position'
```

The existing all-uncalibrated test and the new all-calibrated test both correctly stayed GREEN
pre-fix too, proving those two cases were already provable no-ops for this change.

GREEN (post-fix, fix restored):
- `play-brief-absence.test.ts`: 138/138, including the existing all-uncalibrated test (unchanged
  assertion), the new partial-calibration test (live MRVL repro shape — asserts the reason names
  ONLY "regime fit" and none of "setup"/"entry/signal"/"persistence"/"theta"), and the new
  all-calibrated test (confirms no `thesis health` entry at all).
- `thesis-health.test.ts`: 37/37 (new `uncalibratedThesisPillars` suite: live MRVL-shape partial
  case returns exactly `["market"]`/"Regime fit"; Banger-origin case returns every pillar;
  fully-calibrated case returns `[]`).
- `play-brief.test.ts`: unaffected, confirmed green (narrative side untouched).

Broader regression sweep, all green: full `src/lib/swing/*.test.ts` — **2346/2346** (33 suites),
confirming no regression anywhere else in the swing lane.

`npx tsc --noEmit` clean, whole repo.

Tests run on Node 20 (`/opt/nvm/versions/node/v20.20.2/bin`) via
`npx tsx --experimental-test-module-mocks --test <file>`.
