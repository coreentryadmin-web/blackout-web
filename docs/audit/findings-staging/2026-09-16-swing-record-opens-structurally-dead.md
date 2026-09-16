> **kind:** FINDING

## `GET /api/market/swing/record`'s `summary.opens` was structurally guaranteed to always read 0 — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Lane** | Night Hawk Swings — Ask Largo (coordinator sweep) |
| **Severity** | P2 (a member/Largo-facing field presented as measured, but incapable of ever reporting anything but a fabricated zero) |
| **File** | `src/app/api/market/swing/record/route.ts`, `src/lib/swing/record.ts` |

### Root cause

`buildSwingRecordSummary` correctly computes `opens = records.length - resolved.length` (an
already-tested formula — `record.test.ts:148` asserts `opens === 1` when the input `records`
array includes one genuinely unresolved chain). The bug was one layer up, in how the route built
that `records` array in the first place:

```ts
const rows = await fetchSwingPositionsRange(since, ...);  // no status filter — includes OPEN rows
const roots = new Set<number>();
for (const row of rows) {
  if (!row.graded_at) continue;               // <-- excludes every ungraded row
  roots.add(row.root_position_id ?? row.id);
}
```

Grading only happens once a leg CLOSES or ROLLS (`fetchUngradedSwingPositions`'s own doc comment:
"a leg is graded once it is CLOSED/ROLLED and its forward bars exist"), so a currently live,
committed OPEN/HOLD/TRIM position — with no prior roll history — has `graded_at: null` by
definition. The `if (!row.graded_at) continue` line therefore excluded EVERY such position from
ever seeding a chain root, so it could never enter `records`, so `records.length` could never
exceed `resolved.length`, so `opens` could never be anything but 0 — a dead counter that reads as
a real, live measurement but is mathematically incapable of ever reporting a nonzero value for
this entire class of position (a fresh, un-rolled, still-open swing play — very likely the MOST
common shape of "open" a member would expect this field to count).

`buildSwingRecord`'s own `chainResolved = lastLeg != null && lastLeg.graded` already handles an
unresolved chain correctly (an ungraded single-leg chain reports `outcome: "open"`,
`chainResolved: false`) — the pure record-building logic was never the problem; only the caller's
root-selection filter was.

### Evidence

Live repro, 2026-09-16 (`GET /api/market/swing/record?days=90`, authenticated): three real,
currently committed swing positions — CRWD #39 (HOLD), AAPL #38 (HOLD), AAPL #37 (HOLD) — none
ever graded or rolled (confirmed absent from `closedDeck` too), yet `summary.opens: 0` on every
call, `summary.chains === summary.resolved_chains` (35 === 35) every time regardless of how many
positions are actually open right now.

Two RED tests (`git stash` proven — failed against the pre-fix `if (row.graded_at)` -only
selection logic, passed once the OPEN/HOLD/TRIM branch was added):
- `selectSwingRecordRootIds includes a live OPEN/HOLD/TRIM row even though it has never been graded`
- `selectSwingRecordRootIds does not seed a root for a PENDING (not-yet-committed) or already-graded-via-other-row root`

Full `src/lib/swing/*.test.ts` suite: 1200/1200 pass (was 1198 before the 2 new tests).
`tsc --noEmit` clean.

### Blast radius

Single call site — the root-selection loop only existed in this one route handler. Extracted into
a new pure, exported, unit-tested helper (`selectSwingRecordRootIds` in `record.ts`) rather than
patched inline, so any future caller building the same chain population gets the correct behavior
by construction instead of re-deriving it.

`summary.opens` is currently unused elsewhere in the codebase (grep confirms no other reader), so
the blast radius of the wrong number was limited to whatever surfaces `/record`'s raw JSON
directly (an admin/Largo tool reading the summary) rather than a rendered member panel — still a
real correctness defect (Largo Product Contract point on absence/precision: a fabricated zero is
worse than an honestly omitted field), just not yet a visibly broken UI number.

### Fix rationale

Extend the root-selection predicate to also seed a root from a row that is currently
OPEN/HOLD/TRIM (the same three "live, committed" statuses already used elsewhere in this codebase
— e.g. `play-brief-resolve.ts`'s own `WORKING` set), in addition to the existing graded-row
branch. A `PENDING` (not-yet-committed) row is deliberately left excluded, matching prior
behavior — only a genuinely committed, live position should seed a root. Once such a row seeds a
root, `fetchSwingPositionChain`/`buildSwingRecord` already build and grade its chain correctly
(no changes needed there) — it will show as `chainResolved: false`, `outcome: "open"`, correctly
counted in `opens` and excluded from `resolved_chains`/`wins`/`losses`.

### Tests

`src/lib/swing/record.test.ts` — 2 new tests (RED→GREEN, `git stash` proven), full swing suite
1200/1200 pass, `tsc --noEmit` clean.
