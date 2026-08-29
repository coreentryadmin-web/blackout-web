## Counterfactual skip-grading's bar fetch swallowed every thrown error into the same generic "no bar data" reason — FIXED

> **kind:** `FINDING`

| **Status** | FIXED in `feat/scenario-corpus-harness` |
| **Severity** | P2 — desk-operations calibration surface, not member-facing |
| **Surface** | `src/lib/zerodte/skip-grading.ts` `runSkipGrading`'s `barsFor` |

### Root cause

Following up the previous finding in this same PR (the `blocked_value` reason-aggregation fix):
once the ungradeable `reason` strings actually became visible in the calibration report, a live
run against production showed **194 of 206 real ungradeable rejections** carrying the identical
generic reason — `"no bar data available for the session — neither contract nor underlying path
reconstructable"` — across 11 different gate codes and, necessarily, many different tickers and
session dates over a 30-day window.

`barsFor`'s bar fetch already had a `.catch(() => [] as SkipGradeBar[])` around the whole dynamic
import + Polygon call. That catch makes NO distinction between two very different situations: (1)
the fetch succeeded and Polygon genuinely had zero minute bars for that ticker/session (a quiet
name, an untradeable index root, etc.), and (2) the fetch itself threw — a dynamic-import failure,
a bug in the response mapping, an unexpected exception — and the resulting empty array is not
evidence of anything except that the code never got a chance to try. `gradeSkippedPlay` (the pure
grader) then reports the same generic "no bar data available" message for both cases, because it
only ever sees an empty array, never the fact that fetching it failed outright.

Manually replaying the exact Polygon call `barsFor` makes (`fetchAggBars` for SPY on a recent real
session date, same endpoint/params) from this environment returned 797 real minute bars with
HTTP 200 — proving Polygon data is genuinely available for at least some of the population this
report scores, which rules out "Polygon simply never has bars for anything scored here" as an
explanation for a 94% ungradeable rate. Whether production's specific ungradeable rows are hitting
a real Polygon gap, a symbol-mapping issue, or an outright exception could not be told apart from
the report alone — the fix in this file makes that distinguishable going forward without needing
to reason about it from first principles again.

### Evidence

New test in `skip-grading.test.ts`: `runSkipGrading: an underlying bar fetch that THROWS is
surfaced with the real error, not the generic 'no bar data' reason` — a rejection whose bar fetch
mock throws now persists a counterfactual with `reason: "underlying bar fetch threw: <the actual
message>"` instead of one of the four generic bar-empty reasons `gradeSkippedPlay` emits.

### Blast radius

Only `runSkipGrading`'s own bar-fetch loop; `gradeSkippedPlay` (the pure core) and its existing
callers/tests are unchanged — the swap happens in the data layer, after the verdict is computed,
only when the verdict landed on one of the four known generic bar-empty reasons AND a fetch error
was actually captured for that (ticker, session) pair.

### Fix rationale

Kept the fail-soft contract (`barsFor` still never lets a single row's fetch failure abort the
whole batch — the promise still resolves, never rejects, for the loop above it) while adding a
side-channel (`fetchThrew: string | null`) that the per-row loop consults to override the persisted
reason ONLY when it lands on one of the generic bar-empty messages the pure grader would otherwise
emit. This is deliberately narrower than rewriting `gradeSkippedPlay` to accept an error parameter
directly — the pure core's contract (bars in, verdict out) stays intact and testable in isolation;
only the data layer, which already owns the fetch and its failure modes, gains the extra context.
Next run of `?grade_skips=1` against production will show whether the dominant reason shifts from
the generic message to a specific thrown-error string, which is the concrete next diagnostic step
this fix unlocks (not something this PR concludes on its own).
