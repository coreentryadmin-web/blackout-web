## Night Hawk Swings: a live position's `thesisLevel` can stay "break" even after the authoritative manage-sync snapshot confirms the thesis is intact — self-contradicting Management ("Recommended: HOLD") vs Trade manager read ("Thesis BREAK ... Exit") on the SAME play-brief response, and mis-routes the board row into the EXITING bucket — FIXED

> **kind:** `FINDING`

| **Status** | FIXED |
|---|---|

**Area.** Night Hawk Swings / Ask Largo standing ownership mandate (`src/lib/swing/live-plays.ts`'s
`manageObservablesFromEvent`, consumed by `src/lib/swing/serving.ts`'s `sectionForSwingPlay` and by
every Ask Largo swing play-brief).

**Live repro (2026-10-15, standing 5-engine monitor cycle).** `GET /api/market/nighthawk/horizons?
view=swings` showed a real committed INTC position (`positionId:56`, LONG, `status:"HOLD"`) with:

```
"thesisLevel": "break",
"liveStatus": "HOLD",
"manageAction": undefined,
"manageReasonDetail": "thesis intact, premium above the 0.4× backstop, ample time — hold",
"entryTriggerUnderlyingPx": 101.25,
"invalidationUnderlyingPx": 96.88,
"liveSpot": 95.77
```

And the live Ask Largo brief for the same position (`GET /api/market/swing/play-brief?playId=
SWING:INTC&ticker=INTC&positionId=56`) rendered, in the same response:

```
Management:          "**Recommended:** HOLD ... live hold — EVENT_DRIVEN thesis"
Trade manager read:  "• **Thesis BREAK** — thesis broken. Exit or cut to runner only; don't add size."
```

A member reading this brief gets told to hold AND to exit in the same response, and the board row
sits in the "EXITING" serving section while every other field says HOLD.

### Root cause

`livePlayFromSwingPosition` seeds a spot-only fallback before consulting the authoritative
manage-sync snapshot:

```ts
const broken = structuralBreakFromSpot(dirLc, spot, row.thesis_invalidation_px); // 95.77 <= 96.88 -> true
const spotObs = manageObservablesFromEvent(null, {
  manageAction: broken ? "EXIT" : ...,
  thesisLevel: broken ? "break" : "intact",
});
const { ... thesisLevel ... } = manageObservablesFromEvent(manageEvent, spotObs);
```

`structuralBreakFromSpot` is a crude single-price compare against the PINNED
`row.thesis_invalidation_px` — it has no ex-dividend adjustment and no archetype-specific
`thesis_stop` logic, both of which the real `evaluateSwingManagement` (`manage.ts`) checks via
`structuralStopBroken()` → `underlyingPriceForStructuralStop()`. For this INTC tick, the real
engine ran that check, found the underlying still holding (not broken in its own, more complete
terms), and `manage-sync.ts`'s `thesisStateOf()` correctly stamped `thesis_state:"INTACT"`
(`rung:"hold"`) onto the persisted snapshot — the exact state that function's own doc comment
defines as meaning "the real structural/thesis check ran and did NOT find a break."

`manageObservablesFromEvent` (`live-plays.ts`) is documented as the authoritative overlay ("Spot-
based structural break remains the fallback when **no snapshot exists yet**"), but its
implementation only ever moved `thesisLevel` **toward** `"break"` (three `if`/`else if` branches
matching `BROKEN`/`STOPPED`/`EXPIRY_RISK`) — nothing reset it back to `"intact"` when a present,
authoritative snapshot said the opposite of what the spot-only fallback guessed. So `thesisLevel`
silently stayed `"break"` from the fallback even though the real engine, on the same tick,
disagreed — and `serving.ts`'s `sectionForSwingPlay` routes purely off
`thesisLevel === "break"` into `EXITING`, regardless of `manageAction`/`liveStatus`.

### Fix

Added an `else if (thesisState === "INTACT")` branch to `manageObservablesFromEvent` that resets
`thesisLevel = "intact"`, scoped to exactly the one state `manage-sync.ts` stamps to mean "checked
and not broken" (`rung` `hold`/`insufficient_data`). `STOPPED`/`EXPIRY_RISK` and the `WATCH`-tagged
advisory edge rungs (`catalyst_shift`/`regime_shift`/...) are deliberately left untouched — no live
repro backs changing those, and widening the reset beyond the one state with direct evidence would
be scope creep.

### Evidence

New regression test `src/lib/swing/live-plays.test.ts`: `"livePlayFromSwingPosition: authoritative
INTACT snapshot overrides a stale spot-only break read (live INTC repro, 2026-10-15)"` — feeds the
exact INTC-shaped inputs (spot below the pinned invalidation price, snapshot `thesis_state:
"INTACT"`/`rung:"hold"`) and asserts `thesisLevel === "intact"`. Verified RED pre-fix (`git stash`
on `live-plays.ts` only: 50 pass / 1 fail) and GREEN post-fix (51/51 pass). Full `npm test` (Node
20) and `npx tsc --noEmit` both clean on the fix branch.

### Blast radius

Only `manageObservablesFromEvent`'s own output consumers are affected: `livePlayFromSwingPosition`
(this file), `serving.ts`'s `sectionForSwingPlay` (board bucket routing), and every narrative layer
that reads `HorizonPlay.thesisLevel` (`play-brief-narrative.ts`'s `sellReasonClause`/trade-manager
coaching, `adapters.ts`'s `ThesisLevel` mapping, `deck-sort.ts`'s ranking). No schema change — same
`SwingThesisLevel` union, same field. Every existing test (including the sibling `"latest manage
snapshot overrides spot-only intact read"` test for `EXPIRY_RISK`, which must keep `thesisLevel`
at `"intact"` when spot was already intact) still passes unchanged.

### Fix rationale — what was deliberately left unchanged

Considered resetting `thesisLevel` to `"intact"` for every non-`BROKEN` `thesisState` (i.e. also
`STOPPED`/`WATCH`), which would be a larger, more "complete" fix — rejected because `premium_stop`
(`STOPPED`) is explicitly documented in `manage.ts` as a capital-only backstop that fires "even when
the option is green," independent of thesis validity, and the `WATCH` catch-all covers several
distinct advisory edge rungs this cycle has no live evidence about. Scoping the reset to the one
state (`INTACT`) with a live, reproduced, member-visible contradiction keeps the PR small and
single-issue per the repo's standing issue-handling policy, rather than guessing at behavior for
states with no evidence either way.
