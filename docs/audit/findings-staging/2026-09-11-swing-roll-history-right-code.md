> **kind:** FINDING

## Swing roll-history disclosure renders "$90 contract" instead of "$90 put" — FIXED

| | |
|---|---|
| **Lane** | Night Hawk Swings — Ask Largo play-brief |
| **File** | `src/lib/swing/play-brief-context.ts` (now `play-brief-roll-history.ts`), `play-brief-narrative.ts` (`rollHistoryLine`/`fmtLeg`, read-only) |
| **Status** | FIXED (this PR) |

### Root cause

PR #4802 shipped the roll-history disclosure feature (Ask Largo C6 historical-context point):
`loadRollHistory` walks a chain's `roll_seq` thread and maps each DB row to a
`SwingRollHistoryLeg` for the "Trade manager read" narrative. The row→leg mapping passed
`row.contract_type` straight through as `SwingRollHistoryLeg.right`.

`contract_type` is stored in the ledger as the full word `"call"`/`"put"` — every other reader in
this codebase converts it to the short `"P"`/`"C"` code before using it as a `right`/direction tag
(`closed-plays.ts:68`, `play-brief-resolve.ts:133`, `live-plays.ts:106` all do
`contract_type === "put" ? "P" : "C"`). `rollHistoryLine`'s own `fmtLeg` helper
(`play-brief-narrative.ts`) only recognizes the short code:

```ts
const rightWord = l.right === "P" ? "put" : l.right === "C" ? "call" : "contract";
```

Passing the raw word through meant `l.right` was never `"P"` or `"C"` — it was `"put"`/`"call"` —
so every rolled leg fell through to the generic `"contract"` fallback.

### Evidence

Live repro, 2026-09-11, `GET /api/market/swing/play-brief?playId=SWING:INTC:35&ticker=INTC&positionId=35`
— INTC:35 is the first real once-rolled 2-leg CLOSED chain to hit production after #4802's deploy
completed. The brief's roll-history line read:

> Rolled once — most recently from the $91 contract to the $90 contract.

instead of the correct:

> Rolled once — most recently from the $91 put to the $90 put.

"Contract" is a generic filler word that discards exactly the information (put vs. call) the
disclosure exists to surface — a member reading this has no way to tell what was actually rolled.

### Fix

Extracted the row→leg conversion into a new pure function, `swingRollHistoryLegFromRow`, applying
the same `contract_type === "put" ? "P" : "C"` conversion every other reader already uses. Moved it
to a new standalone file, `play-brief-roll-history.ts` — `play-brief-context.ts` has heavy top-level
imports (`fetchEcosystemContext`, `fetchVectorFullState`) that transitively pull in
`gex-positioning.ts`'s `server-only` guard, so a unit test importing anything from that file (even a
pure, dependency-free function) fails at module load with `This module cannot be imported from a
Client Component module` — confirmed by reproducing the failure before the move and confirming it
disappears after. The new file has zero heavy imports (only a type-only import from
`play-brief-types.ts`, erased at compile time), so it can be tested directly and cheaply.

### Blast radius

Single call site (`loadRollHistory`'s `chain.map(...)`), one consumer (`rollHistoryLine`'s
`fmtLeg`). No other reader of `SwingRollHistoryLeg.right` exists yet (the feature is new, from
#4802, not yet consumed elsewhere).

### Fix rationale

Fixing the conversion in place (inside `play-brief-context.ts`) was the smaller diff, but would have
left the bug's root class — a pure function untestable because of its file's heavy import graph —
unaddressed and prone to recurring on the next pure helper added to that file. Extracting to a new
lightweight file costs one extra file but makes the conversion logic directly, cheaply unit-testable
and sets the pattern other `play-brief-context.ts` pure helpers can follow.

### Evidence of testing

New file `src/lib/swing/play-brief-roll-history.ts` (pure function) +
`src/lib/swing/play-brief-roll-history.test.ts` (2 tests: `"put"` → `"P"`, `"call"` → `"C"`).
RED→GREEN proven directly: reverted the conversion to a passthrough, confirmed both new tests fail
(`'call' !== 'C'`, `'put' !== 'P'`), restored the fix, confirmed both pass. Also confirmed the
extraction itself was necessary by reproducing the `server-only` load failure when the test imported
from `play-brief-context.ts` directly, then confirming it resolves once the pure function moves to
the new dependency-free file. `npx tsc --noEmit`: clean. Full `npm test`: run alongside this fix.
