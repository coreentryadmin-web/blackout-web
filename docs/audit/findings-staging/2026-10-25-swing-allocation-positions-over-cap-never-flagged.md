> **kind:** FINDING

## Night Hawk Swings — `allocateSwingBook`'s `positionsOverCap` could never populate, despite its own documented intent — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Surface** | `src/lib/swing/swing-allocation.ts` (`allocateSwingBook`) |
| **Severity** | P3 (reporting-field gap — zero downstream consumers found, see Blast radius) |

### Root cause

`SwingCapsApplied.positionsOverCap`'s own doc comment states: *"Tickers whose proposed weight
exceeded the per-position cap (only possible via injected existing weights)."* Nothing in the
function ever implemented that exception path.

The per-decision `per_position` cap flag checks `proposedPct > caps.perPositionPct` — but
`proposedPct` is unconditionally set to `caps.perPositionPct` two lines earlier (`const
proposedPct = caps.perPositionPct; // never resized — enforce:false`), so that comparison is the
cap compared to itself and can never be true. That part is correct **by design**, not a bug — a
freshly-evaluated candidate can't be sized above the cap it's capped to in the first place.

The real gap is the documented exception the field exists for: an **already-held** position whose
`weightPct` (injected via `existing`) already exceeds the cap — e.g. appreciation, a manual
override, a stale ledger weight — was silently invisible. No code path anywhere in the function
ever read an existing position's own weight against `caps.perPositionPct`.

### Evidence

Live repro:

```js
allocateSwingBook(
  [{ ticker: "AMD", direction: "LONG", score: 70 }],
  [{ ticker: "NVDA", direction: "LONG", expiry: null, weightPct: 9 }], // 9% — past the 5% cap
);
```

Pre-fix: `capsApplied.positionsOverCap` reads `[]` regardless of how far over cap `NVDA` sits.
Post-fix: `capsApplied.positionsOverCap` reads `["NVDA"]`.

### Blast radius

`git grep -rln "positionsOverCap" src/` (excluding this file and its test) returns **zero
consumers** — unlike the per-decision `capFlags[].wouldBreach` field this same module produces
(which `commit.ts`'s Gate 2 does read and treat as a live commit-block, per this file's own header),
nothing downstream reads `capsApplied.positionsOverCap` today. This fix changes no live commit
behavior for that reason — it corrects a summary/reporting field whose own doc comment promised
behavior it never delivered, so any future caller (an operator dashboard, a desk summary, a future
wiring of this field into a gate) that trusted the doc comment would have silently gotten a false
"nothing over cap" negative.

### Fix rationale

Added the missing check the doc comment always claimed existed: a loop over `existing`, independent
of `candidates`/`decisions` (an over-cap holding is over-cap whether or not it's being re-evaluated
this pass), pushing the uppercased ticker when its injected (or cap-defaulted) `weightPct` exceeds
`caps.perPositionPct`. Left the per-decision `per_position` flag's own (structurally-always-false)
comparison untouched — that logic is correct for what it actually checks (a new candidate's fixed
proposed weight vs. the cap it equals by construction), it just was never the right place to catch
the documented exception case.

### Tests

Added three cases to `swing-allocation.test.ts`: an existing over-cap position gets flagged, an
at-or-under-cap position never is, and multiple over-cap positions are all flagged (uppercased,
independent of whether they also appear as candidates). RED→GREEN confirmed: reverting only the
source fix (keeping the new tests) fails 2/13 exactly as expected; reapplying passes 13/13.

- `npx tsx --experimental-test-module-mocks --test src/lib/swing/swing-allocation.test.ts` — 13/13 pass
- `npx tsc --noEmit` — clean
- Full `npm test` (Node 20) run alongside this PR
