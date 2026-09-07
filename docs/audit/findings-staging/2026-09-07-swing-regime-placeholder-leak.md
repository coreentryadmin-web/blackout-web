# Swing live-plays regime fix (#4481) leaked a placeholder string into the live Ask Largo narrative — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-swing-regime-placeholder-leak |
| **Priority** | P2 |
| **Area** | Ask Largo / Night Hawk Swings — swing play-brief narrative |
| **Status** | FIXED |

## Symptom

Found during the standing Ask Largo deep-dive mandate, live spot-check of a real committed swing
position (`GET /api/market/swing/play-brief?playId=SWING:NRG:34`, member-facing prod response).
The **Verdict** section rendered:

```
**NRG 110C 11DTE** · LONG · HOLD

Grade **C** · score 27

regime read
```

and the **Why this setup** section rendered:

```
**Sub-lane:** STANDARD

regime read

No pillar breakdown on this row — grade is from lane score only.
```

`"regime read"` is not a real market-regime descriptor — it is a literal placeholder string this
session's own earlier fix (#4481, `docs/audit/findings-staging/2026-09-07-swing-thesis-health-
regime-wiring.md`) introduced as a fallback value, and it shipped to production reading as garbled
copy in a paying member's trade brief.

## Root cause

`livePlayFromSwingPosition()` (`src/lib/swing/live-plays.ts`) set:

```ts
const regime =
  row.feature_vector && typeof row.feature_vector.pil_regime === "number"
    ? (row.archetype ?? "regime read")
    : null;
```

Two compounding mistakes:

1. **`play.regime` is a raw display string, not an internal flag.** `play-brief.ts`'s Verdict
   section does `if (play.regime) verdictLines.push(play.regime)` — no label, printed verbatim.
   `thesis-health.ts`'s `regimeScore()` also uses it directly as the shown pillar `label`
   (`label: regime ?? (top ? top.label : "unread")`). The prior fix treated it as an internal
   "was the REGIME pillar grounded" signal for `thesisHealthUncalibrated()` and didn't account for
   these two direct-display consumers.
2. **`regime` and `archetype` are different concepts, conflated.** Elsewhere in this codebase
   (`admin-spx-dashboard.ts`, `x-content.ts`) `regime` means a genuine market-condition descriptor
   (SPX gamma regime, Vector's `regime.posture` — "short gamma", "trending", etc.). The swing
   `archetype` (BREAKOUT/PULLBACK/...) describes the *setup type*, already shown on its own labeled
   `"Archetype: X"` verdict line. Falling back to `row.archetype` on the "regime" line would have
   silently duplicated that text when archetype WAS present, and produced the meaningless literal
   `"regime read"` string when it wasn't (this row's case — archetype is null for NRG).

No genuine swing-specific market-regime descriptor exists on the committed position row today.

## Fix

`regime` is now unconditionally `null` for every live/committed swing position — honest omission,
matching the LARGO-PRODUCT-CONTRACT's `confidence`-omission principle applied to this field: an
absent or ungrounded value must never be filled with an invented placeholder or a same-value
substitute from a different concept. This reverts the display-facing synthesis from #4481 while
leaving the rest of that PR's audit trail intact (it correctly identified `thesisHealthUncalibrated`
as gating on three OTHER pillars, unaffected by this reversion).

## Blast radius

Same single call site as #4481: `livePlayFromSwingPosition` → every consumer of
`livePlaysFromOpenPositions`'s output (swing command deck live sections, Ask Largo swing brief).
No schema change, no new IO.

## Scope / follow-up not covered by this fix

A genuine swing-specific market-regime label (e.g. sourced from Vector's `regime.posture`, which
`play-brief.ts` already reads elsewhere in this same envelope for the dealer-posture narrative)
would need to flow through a different layer than `live-plays.ts` builds at — `composeSwingPlayBrief`
already has `ctx` access to Vector data that `livePlayFromSwingPosition` does not. Deferred as a
real architecture question, not resolved here; flagged on the #4076 collaboration thread.

## Evidence

Live production repro: `GET /api/market/swing/play-brief?playId=SWING:NRG:34` returned the literal
`"regime read"` string in both Verdict and "Why this setup" sections before this fix (captured
above). RED→GREEN: `live-plays.test.ts`'s regime test rewritten to assert `regime` is always `null`
— fails against the pre-fix code (14/15, the old test asserted `"BREAKOUT"` for the grounded case),
passes post-fix (15/15). Full suite: `node --import tsx --experimental-test-module-mocks --test
src/lib/swing/live-plays.test.ts src/lib/swing/thesis-health.test.ts src/lib/swing/play-brief.test.ts`
— 54/54 pass. `npx tsc --noEmit` — clean.
