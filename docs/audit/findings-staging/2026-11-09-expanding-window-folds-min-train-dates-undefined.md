> **kind:** FINDING

## `expandingWindowFolds` with `minTrainDates: 0` silently dropped fold 1's holdout rows (`trainEndDate` poisoned to `undefined`) — FIXED

| **Status** | FIXED |
|---|---|
| **Severity** | P3 (latent correctness bug in a committed, exported, unit-tested pure helper; no live production caller yet, but it is wired as the shared walk-forward-validation primitive for future chronological-backtest audit tooling) |
| **Area** | `src/features/nighthawk/lib/chronological-split.ts` — `expandingWindowFolds` |

### Root cause

`chronological-split.ts` has two closely related split functions over the same `distinctDates`
array: `chronologicalSplit` (a single train/holdout cut) and `expandingWindowFolds` (repeated
walk-forward folds). Both need to turn a *count* of training dates into the actual
`trainEndDate` string by indexing `distinctDates[trainDateCount - 1]`, and both need to handle
the case where that count is `0` (an intentionally-empty training window) — `distinctDates[-1]`
is not an error in JavaScript, it is `undefined`.

`chronologicalSplit` already guards this exact case (line ~77 of the file):

```ts
trainEndDate = trainDateCount > 0 ? distinctDates[trainDateCount - 1]! : "";
```

`expandingWindowFolds` never got the same guard — it computed the identical expression bare:

```ts
const trainEndDate = distinctDates[trainDateCount - 1]!;
```

`minTrainDates: 0` is not forbidden by the type (`{ minTrainDates: number; ... }`) or documented
as invalid in the function's own doc comment ("`minTrainDates` bounds fold 1's train size so the
earliest fold isn't evaluated off a near-empty history" — nothing says it must be `>= 1`), so
fold 1 starts with `trainDateCount = minTrainDates = 0`, and `trainEndDate` becomes the literal
value `undefined` — a direct violation of the function's own declared return type
(`ExpandingWindowFold<T>.trainEndDate: string`).

That `undefined` then poisons **both** of the filters that use it, not just the one that was
*supposed* to come back empty:

```ts
const train = sorted.filter((r) => dateOf(r) <= trainEndDate);
const holdout = sorted.filter((r) => dateOf(r) > trainEndDate && dateOf(r) <= holdoutEndDate);
```

`dateOf(r)` is always a real `YYYY-MM-DD` string. A relational comparison (`<`, `<=`, `>`, `>=`)
between a string and `undefined` is NOT a string comparison — per the spec's Abstract Relational
Comparison algorithm, when either operand isn't already both-strings it falls back to `ToNumber`
on both sides; `ToNumber(undefined)` is `NaN`, and every relational comparison against `NaN` is
`false`. So:

- `dateOf(r) <= undefined` → always `false` — `train` comes back empty. This happens to be the
  *correct* answer for `minTrainDates: 0` (an empty training window really should hold no rows),
  but it is correct **by accident**, not because the code computed it on purpose.
- `dateOf(r) > undefined` → **also** always `false` — `holdout` comes back empty **even though
  the real holdout window has real, dated rows in it**. This is the actual defect: fold 1 reports
  `holdout: []` and `degenerate: true` when the true holdout slice (`distinctDates[0..
  holdoutDatesPerFold-1]`'s rows) is non-empty and perfectly computable.

A caller reading `fold.holdout.length === 0` has no way to tell "the window genuinely had
nothing in it" apart from "the comparison silently broke" — the output looks like ordinary thin
data, not a bug.

### Evidence (RED → GREEN)

Added to `src/features/nighthawk/lib/chronological-split.test.ts`:

```
test("minTrainDates: 0 does not poison trainEndDate to undefined (sibling-function parity)", ...)
```

Pre-fix (RED), `npx tsx --experimental-test-module-mocks --test
src/features/nighthawk/lib/chronological-split.test.ts`:

```
not ok 7 - minTrainDates: 0 does not poison trainEndDate to undefined (sibling-function parity)
  error: |-
    Expected values to be strictly equal:
    + actual - expected
    + 'undefined'
    - 'string'
# pass 15
# fail 1
```

Reproduced independently with a scratch script calling `expandingWindowFolds` directly over 4
real dates with `{ minTrainDates: 0, holdoutDatesPerFold: 1 }`: fold 1 printed as
`{ fold: 1, train: [], holdout: [], degenerate: true }` — note `trainEndDate` is entirely absent
from the JSON (because it was the literal `undefined`, which `JSON.stringify` drops), and
`holdout` is empty despite `2026-09-01`'s row existing in the input and belonging squarely in
fold 1's holdout window.

Post-fix (GREEN), same command:

```
ok 7 - minTrainDates: 0 does not poison trainEndDate to undefined (sibling-function parity)
# pass 16
# fail 0
```

`npx tsc --noEmit` clean.

### Blast radius

Single call site inside the module — `expandingWindowFolds` is the only function with this bare
`distinctDates[trainDateCount - 1]!` indexing; `chronologicalSplit` in the same file already had
the guard (that's how this diff was found — comparing the two functions' otherwise-identical
logic surfaced the asymmetry). No other file in the repo currently calls `expandingWindowFolds`
(checked via repo-wide grep — only its own test file does today), so there is no live production
behavior change from this fix; it closes a latent defect in a shared primitive before the first
real caller (a future chronological out-of-sample backtest script, per the module's own header
comment) can trip over it silently.

### Fix rationale

Mirrored the exact guard `chronologicalSplit` already uses for the identical computation:
`trainDateCount > 0 ? distinctDates[trainDateCount - 1]! : ""`. This keeps the two sibling
functions' handling of an empty training window consistent (both now use the same `""` sentinel,
which is `<` every real date string and therefore correctly includes all of it in `holdout`,
while still excluding everything from `train`). Deliberately did not add input validation that
throws on `minTrainDates < 1` (unlike `chronologicalSplit`'s `holdoutFraction` range check) —
`minTrainDates: 0` is a meaningful, well-defined request ("start folding immediately, with no
minimum history"), not a malformed input, so the right fix is to compute it correctly rather than
to reject it. Everything else in the function (the loop bound, `holdoutEndDateIndex` clamping,
`maxFolds`, the `degenerate` flag) was left untouched — those were already correct.
