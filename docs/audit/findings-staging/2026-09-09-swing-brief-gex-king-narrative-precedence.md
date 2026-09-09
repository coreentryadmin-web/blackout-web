> **kind:** `FINDING`

## Swing play-brief "GEX king strike" line used a different precedence than the rest of the same envelope — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Ask Largo swing play-brief, `chartLevelsSection` ("Levels on chart" section), `src/lib/swing/play-brief-intel.ts` |
| **PR** | (pending — `fix/swing-brief-gex-king-narrative-precedence`) |

### Symptom

Live Ask Largo monitor cycle (2026-09-09), pulling a closed swing play brief not previously
checked this session (`SWING:AAPL:36`, a real CLOSED position from `/api/market/swing/record`):
the SAME `GET /api/market/swing/play-brief` response showed **two different "GEX king" prices for
the same ticker at the same instant**:

- "Levels on chart" narrative section body: `GEX king strike: **330.00**`
- The structured `envelope.levels` array (which feeds the Key-levels summary and, per the
  markdown render, the chip the UI reads): `{"label": "GEX king", "price": 320, ...}`

This is the exact same bug CLASS already caught and fixed once this session for a different call
site (2026-09-08, live CG SWING_CG_25 — see the "GEX king level prefers a live Vector ladder king
over the GEX matrix" test in `play-brief.test.ts`) — but that fix only touched
`play-brief.ts`'s structured `levels` builder. A THIRD call site, `chartLevelsSection` in
`play-brief-intel.ts` (the "Levels on chart" narrative bullet list), still computed king strike
independently and disagreed with the other two.

### Root cause

Three separate places in the swing play-brief pipeline compute "GEX king strike," and only two of
them agreed:

1. `play-brief.ts`'s structured `levels` array — `vecKing ?? gex?.gex_king_strike` (prefers a live
   Vector-ladder king, falls back to the GEX matrix).
2. `play-brief-narrative.ts`'s `focalLevelsFrom` (feeds the "Trade manager read" section) —
   `vecKing ?? kingFromGex`, same precedence as #1.
3. `play-brief-intel.ts`'s `chartLevelsSection` (feeds the "Levels on chart" section) — read
   `gex.gex_king_strike` directly, with a comment stating "King strike is GEX-only in this section
   — Vector presence irrelevant" (added in #4372, which was fixing a DIFFERENT bug — a stale-gate
   omission — and never revisited the underlying precedence choice).

Call wall / put wall / gamma flip all correctly use the `vecX ?? gex?.x` precedence in ALL THREE
call sites — only "GEX king" diverged, and only in this one section. Because the Vector ladder's
king strike and the raw GEX-matrix `gex_king_strike` are independently-computed numbers (different
upstream pipelines — see the FINDING behind #4620), they routinely disagree in real data, so this
was not a rare edge case: it fired on the very first not-yet-audited closed play checked this
cycle.

### Evidence

Live `GET /api/market/swing/play-brief?playId=SWING:AAPL:36` (2026-09-09, authenticated via
`mintClerkPremiumSession`), same response, same `asOf` timestamp:

```
"Levels on chart" section body:  "GEX king strike: **330.00**"
envelope.levels[]:                {"label": "GEX king", "price": 320, ...}
```

`330.00` is `gex.gex_king_strike` from the raw GEX matrix; `320` is the Vector ladder's king strike
(rounded near `gamma flip: 320.19`, a separate, correctly-agreeing level in the same brief).

### Fix

`chartLevelsSection` now computes king the same way as the other two call sites:
`vecKingForLevels ?? gex?.gex_king_strike`, gated the same way call wall/put wall/flip already are
in this section (suppressed only when it would fall through to a STALE GEX matrix with no live
Vector reading available). Regression test added:
`chartLevelsSection: GEX king strike prefers a live Vector ladder king over the GEX matrix,
matching the structured levels/narrative precedence` in `play-brief-intel.test.ts` — fails on the
pre-fix code (asserts `102.00`, the Vector ladder king, and refutes `105.00`, the stale-relative-to-it
GEX matrix value), passes after.

### Blast radius

Only this one function/section. The existing stale-gating regression test
(`chartLevelsSection: stale GEX king strike omitted even when Vector desk is present`) still passes
unchanged, since that fixture has no `vector.ladder`, so the new precedence correctly falls through
to the same stale-GEX-suppression behavior it exercised before.

### Fix rationale

Match the two already-correct call sites rather than invent a fourth precedence rule, and rather
than "fix" #1/#2 to match #3's GEX-only rule — #1/#2's Vector-ladder-preferred precedence is the
one with an explicit regression test already asserting it (`play-brief.test.ts`, from the #4620
finding) and is consistent with how call wall/put wall/flip already behave in every section
including this one. `npx tsc --noEmit` clean; `play-brief-intel.test.ts` full file green (59/59)
on Node 20; full suite run in progress at time of PR.
