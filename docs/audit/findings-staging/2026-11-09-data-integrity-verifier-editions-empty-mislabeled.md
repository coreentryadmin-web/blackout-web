# 2026-11-09: data-integrity-verifier.ts reported "consistency-only" for an empty nighthawk_editions table — nothing was actually checked

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

`src/lib/correctness/data-integrity-verifier.ts`'s `checkPostgres()` has a dedicated branch for an
EMPTY `nighthawk_editions` table (pre-launch, or the publish writer never having landed a single
row). That branch reported the metric outcome `"consistency-only"` — the status `types.ts`'s own
HONESTY PRINCIPLE reserves for "every applicable check held, but no independent oracle exists for
this metric." An empty table has no row to recompute and no invariant to hold — there was nothing
applicable to check at all this run. The correct label, per the same file's own sibling branch one
table down (`nighthawk_play_outcomes`, empty case), is `"skipped"`.

This is the same class of bug already fixed twice in this exact correctness-verifier vein this
session: `largo-verifier.ts` (self-consistency miscounted as an independent pass) and
`nighthawk-verifier.ts` (an L4 check emitting "pass" when the comparison never actually ran because
it was gated out). Here the shape is: a check that never ran at all (no data existed to check)
emitting a status reserved for checks that DID run and held.

## Root cause

`checkPostgres()` probes `nighthawk_editions` for a latest-published-at timestamp and a row count.
When `total === 0` (empty table), the code pushed:

```ts
mk("sanity-bound", "pg_editions", "consistency-only",
  "nighthawk_editions is empty — no edition has ever published ...")
```

Three lines above it, `checks.push(mk("freshness", "pg_editions", "skipped", "... probe failed/absent
— skipped."))` already uses `"skipped"` for the sibling "no row at all" case (the probe itself
failing). And 40 lines later, the structurally identical `nighthawk_play_outcomes` empty-table
branch gets it right:

```ts
checks.push(
  mk("sanity-bound", "pg_nh_outcomes", "skipped",
    "nighthawk_play_outcomes empty/absent — no outcomes ledger to sanity-check yet.", ...)
);
```

Three branches in the same function, two of them correctly label "nothing to check" as `"skipped"`,
one of them (the editions-empty branch) mislabeled the identical situation `"consistency-only"`. The
correct label was evidently known (the author wrote it correctly twice) and simply not applied
consistently on the third.

## Why it matters (not cosmetic)

`run-correctness.ts`'s `collectCoverageGaps()` treats every metric whose rolled-up status is
`"consistency-only"` as a reported DATALAYER coverage gap (with a human-readable reason surfaced in
the scorecard/report). `flattenTotals()` also counts it under `totals.consistencyOnly`, not
`totals.skipped`. So on a pre-launch deploy, or any deploy where the `nighthawk-playbook` publish
writer has never yet landed a row, every correctness run falsely reports a DATALAYER coverage gap on
a metric that performed zero checks this run — exactly the kind of "nothing ran, but it reads as
partially confirmed" false signal `types.ts`'s HONESTY PRINCIPLE exists to rule out.

## Evidence (RED → GREEN, via `git stash`)

Added `verifyDataIntegrity: an EMPTY nighthawk_editions table is reported skipped, not
consistency-only (nothing was actually checked)` to `data-integrity-verifier.test.ts`, extending the
existing `../db` mock in that file to accept a configurable `dbQuery` handler (previously a static
stub, since the file's prior tests only exercised the pure `ageMin()` helper and never called
`verifyDataIntegrity` itself).

RED (`git stash -- src/lib/correctness/data-integrity-verifier.ts`, fix removed, test left in place):

```
not ok 7 - verifyDataIntegrity: an EMPTY nighthawk_editions table is reported skipped, not consistency-only
  error: empty nighthawk_editions has nothing applicable to check — expected "skipped" ...
  actual: 'consistency-only'
  expected: 'skipped'
# pass 6
# fail 1
```

GREEN (`git stash pop`, fix restored):

```
ok 7 - verifyDataIntegrity: an EMPTY nighthawk_editions table is reported skipped, not consistency-only
# pass 7
# fail 0
```

`npx tsc --noEmit`: clean, no errors (Node 20).

## Fix

Changed the editions-empty branch's outcome from `"consistency-only"` to `"skipped"`, matching the
sibling `pg_nh_outcomes`-empty branch's convention exactly. Left the layer (`"sanity-bound"`) and the
rest of the detail message unchanged (lightly reworded to "no edition has ever published **yet**" /
"no cadence baseline **yet to check against**" to read naturally alongside "skipped" rather than
"not confirmed").

## Blast radius

Grepped every `"consistency-only"` outcome across `src/lib/correctness/*.ts` for the same
empty/absent/never-fired shape (`empty|no .* rows|no .* data|absent|never (published|opened|fired)`)
— no other instance of this exact mislabel found in `market-context-verifier.ts`,
`flows-verifier.ts`, `flow-anomaly-scope.ts`, or `track-record-verifier.ts`; those files' own
empty/unavailable branches already use `"skipped"` consistently. One other candidate was reviewed
and deliberately left alone: `checkRedis()`'s raw-TTL-probe-returned-nothing branch (`redis_ttl`
metric) also uses `ctx.rth ? "consistency-only" : "skipped"` for a null probe, but its own detail
string explicitly argues the companion `redis_gex` check (a different metric, same underlying key)
already covers sanity + freshness for that cache entry this run — a defensible design call, not the
same clear-cut "no sibling check even ran" situation `pg_editions` was in. Flagging it for a future
round to look at with fresh eyes rather than folding it into this single-issue fix.

## Still open / unchecked (for the next round)

- `checkRedis()`'s `redis_ttl` "probe returned nothing → consistency-only during RTH" branch
  (`src/lib/correctness/data-integrity-verifier.ts`, the raw TTL probe block) — worth a second,
  skeptical look at whether "covered by the companion check above" genuinely holds, or is the same
  mislabel in a more defensible disguise.
- `market-context-verifier.ts`, `flows-verifier.ts`, `flow-anomaly-scope.ts`, `track-record-verifier.ts`
  were all read line-by-line this round against the same outcome-mislabeled-vs-contract lens
  (self-consistency miscounted as independent; a check emitting a status when the comparison never
  ran) — no further bug of that class found in any of them. Treat as read/low-yield for that
  specific lens unless a new angle surfaces; `desk-verifier.ts` still has no dedicated test file
  (flagged by round 491, not yet acted on).
