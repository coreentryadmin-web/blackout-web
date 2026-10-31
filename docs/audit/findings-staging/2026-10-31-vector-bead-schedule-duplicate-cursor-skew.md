# 2026-10-31 Vector bead scheduler's round-robin cursor skews one slot per duplicate roster entry

> **kind:** FINDING

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P3 latent correctness bug (pure scheduler helper; no live-input path currently triggers it) |

## Root cause

`selectTickersToRecord` (`src/features/vector/lib/vector-bead-schedule-core.ts`) round-robins a
ticker roster across ticks by handing back `nextCursor`, which the caller feeds in as `cursor` on
the next tick (`vector-bead-recorder-core.ts`'s `sharedSweepCursor`). The function's own comment
states the contract exactly: *"Next tick resumes just past the last ticker we actually STARTED."*

It computed that position as a running **count**, not the loop's actual **position**:

```ts
nextCursor = (startAt + start.length + busy.length) % (n || 1);
```

That count silently undercounts whenever a roster entry is skipped WITHOUT landing in `start` or
`busy` — which happens exactly once per path: the duplicate-ticker guard

```ts
if (seen.has(ticker)) continue;
```

A duplicate still consumes one position in the circularly-ordered roster (the loop visited it), but
contributes nothing to `start.length + busy.length`, so every ticker processed *after* a duplicate
gets attributed to a position one slot EARLIER than its real index. The last-started ticker's
`nextCursor` then lands ON that ticker's own roster index instead of one past it — the literal
opposite of "resumes just past."

## Evidence

Roster `["A", "B", "A", "C"]` (the third entry is a duplicate of the first), `cursor: 0`, no
in-flight tickers, a limit well above 4 so nothing defers:

- Walking the roster: `A` starts (position 0), `B` starts (position 1), the second `A` is the
  duplicate and is skipped via `seen.has` (position 2, contributes to neither bucket), `C` starts
  (position 3).
- Correct `nextCursor`: one past `C`'s own index (3), i.e. `4 % 4 = 0` — the next tick should wrap
  the lap back to `A`.
- Buggy code's `nextCursor`: `(0 + start.length=3 + busy.length=0) % 4 = 3` — `C`'s *own* index,
  not one past it.

Confirmed directly against the unfixed function (`git stash` on the source file alone, `node
--import tsx` against a scratch script): `selectTickersToRecord({tickers:["A","B","A","C"],
inFlight:new Set(), limit:10, cursor:0})` returns `nextCursor: 3`. Feeding that back in as the next
tick's `cursor` starts the lap at `C` again — `C` is re-offered to the very next tick before `A`
or `B` get their turn, which is precisely the fairness bug (PR history above this function: roster
122 / limit 64 starving the tail completely) this scheduler exists to prevent, now reachable
through a duplicate roster entry instead of a binding concurrency ceiling.

RED→GREEN proven via `git stash` on `vector-bead-schedule-core.ts` alone (test file kept): pre-fix,
the new regression test's `assert.equal(d.nextCursor, 0, ...)` fails (`nextCursor` is `3`); post-fix
it passes, and the second assertion (`cursor: d.nextCursor` on a fresh call starts `["A","B","C"]`
again rather than re-serving `C` first) also passes.

## Blast radius

Single call site that matters for live behavior: `recordSharedUniverseWallSamples`
(`vector-bead-recorder-core.ts`) feeds `sharedSweepCursor` through `selectTickersToRecord` every
5s tick. **Checked and confirmed this cannot fire in production today**: the roster it passes
(`listSharedUniverseTickers()` → `mergeSharedUniverseTickers`) already dedupes via the exact same
`trim().toUpperCase()` normalization `selectTickersToRecord`'s own `seen` guard uses, and the
sibling active-viewer lane's roster (`getActiveVectorTickers()`) is sourced from a `Map` keyed by
the same normalized ticker, so it is also duplicate-free by construction. This is a latent defect
in the exported pure function's own stated contract — already partially guarded by an existing test
("a ticker repeated in the roster is started at most once") that checked `start` but never checked
`nextCursor` — rather than an active production symptom. Fixing it at the source keeps the function
honest for any future caller (or test) that doesn't pre-dedupe, and the existing fairness tests
(roster 122 / limit 64 simulations) all still pass unchanged.

## Fix

Replaced the count-based derivation with the loop's own position: iterate `ordered` by index `i`
and set `nextCursor = (startAt + i + 1) % (n || 1)` only when a ticker actually starts. `i` is the
true roster position regardless of how many duplicates, busy, or deferred entries preceded it in
this tick, so "just past the last started ticker" is now computed directly from where that ticker
actually sits in the circular order, not reconstructed from two independent counters that silently
drift apart whenever a duplicate is skipped. No change to `start`/`busy`/`deferred` bucketing, the
`free`-slot/ceiling logic, or any other exported function — this only corrects `nextCursor`.

## Verify

- `npx tsx --experimental-test-module-mocks --test src/features/vector/lib/vector-bead-schedule-core.test.ts`
  — 16/16 green (new regression test included)
- `npx tsx --experimental-test-module-mocks --test src/features/vector/lib/vector-bead-schedule-core.test.ts src/features/vector/lib/vector-bead-recorder-core.test.ts src/features/vector/lib/vector-bead-recorder-logic.test.ts`
  — 47/47 green, no regressions in the callers that depend on this scheduler
- `npx tsc --noEmit` and `npx eslint` on the touched files — clean
