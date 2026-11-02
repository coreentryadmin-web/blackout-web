> **kind:** FINDING

## `test-date-bomb-scan.mjs` reports the FIRST-SCANNED offset as "earliest", not the actual earliest — FIXED

| **Status** | FIXED |
|---|---|

### Root cause

`scripts/audit/test-date-bomb-scan.mjs` exists specifically to tell you how soon a date-bomb test
will fire, so the report can say "fires within +Nd" with N being the *earliest* offset that trips
it (its own header comment: "Report the EARLIEST offset that trips it, so the report says how
long there is before it fires rather than only that it eventually does.").

The candidate-selection loop did not actually compute a minimum. It kept whichever `offsetDays`
value was *encountered first* while iterating `runs` in whatever order they were pushed:

```js
const candidates = new Map(); // name -> { days, file }
for (const r of runs) {
  if (r.offsetDays === 0 || !r.ran) continue;
  for (const [name, file] of r.failures) {
    if (baseline.failures.has(name)) continue;
    if (!candidates.has(name)) candidates.set(name, { days: r.offsetDays, file }); // <- first wins
  }
}
```

`runs` is built by pushing one result per entry of `OFFSET_DAYS`, which is parsed straight from
`--offsets=<csv>` with **no sort**:

```js
const OFFSET_DAYS = arg("offsets", "3,10,45,120,400")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);
```

The documented default (`3,10,45,120,400`) happens to already be ascending, so the bug was
invisible on every default run. But nothing enforces that order, and `--offsets=120,10,45` — a
perfectly ordinary thing to type, with no documented requirement to sort it — scans `+120d`
*before* `+10d`. A test that fails at both offsets then gets recorded with `days: 120` (first
encountered) instead of `days: 10` (the actual earliest), because `!candidates.has(name)` only
ever looks at "have I seen this name before", never at "is this offset smaller than what I already
recorded."

### Evidence

Added `scripts/audit/date-bomb-select.test.mjs` against the extracted pure function
`selectEarliestBombCandidates` (new sibling module `scripts/audit/date-bomb-select.mjs`, needed
because the main script runs `npm test` via `spawnSync` at module scope and can't be imported
directly by the test runner).

RED (old "first one wins" logic, proven via `git stash`/manual revert of the module to the
pre-fix body):

```
must report the earliest offset (10), not the first-scanned one (120)
120 !== 10
AssertionError [ERR_ASSERTION]
# pass 2
# fail 1
```

GREEN (fixed "track the minimum" logic):

```
# tests 3
# pass 3
# fail 0
```

Repro vector: `runs = [{offsetDays:120,...bombTest fails...}, {offsetDays:10,...bombTest
fails...}, {offsetDays:45,...bombTest fails...}]` (i.e. what `--offsets=120,10,45` would produce)
— old code reports `days: 120`, new code reports `days: 10`.

### Blast radius

Single call site: the `candidates` loop in `test-date-bomb-scan.mjs`'s main body. No other script
imports or duplicates this selection logic. The bug only manifests when `--offsets` is passed
out of ascending order — every run so far (this tool has no documented prior runs with a custom
`--offsets` value) used the ascending default, so no prior report is known to be affected; the fix
is preventative as well as corrective, since the next person who reaches for `--offsets` to bisect
a bomb more precisely (e.g. `--offsets=120,60,30,15,7` while narrowing in from a wide first pass)
would otherwise silently get a wrong, overstated "safe for N days" answer.

### Fix rationale

Extracted the selection logic to `scripts/audit/date-bomb-select.mjs` (a plain pure function,
`selectEarliestBombCandidates(baselineFailureNames, runs)`) so it's unit-testable without shelling
out to `npm test`, and changed the loop to explicitly track the minimum `offsetDays` per test name:

```js
const existing = candidates.get(name);
if (!existing || r.offsetDays < existing.days) candidates.set(name, { days: r.offsetDays, file });
```

This makes the result correct regardless of the order `runs`/`OFFSET_DAYS` is in, rather than
silently depending on the caller always passing offsets pre-sorted — which was never stated as a
requirement anywhere in the script's `--offsets` documentation or `--help`-equivalent usage line.
An alternative fix (sort `OFFSET_DAYS` ascending once, after parsing) would also have worked, but
leaves the real defect in place one level up: `candidates` would still select "first encountered"
rather than "actually smallest", which is a latent footgun for the next person who refactors the
run-building loop. Making the selection function itself order-independent is the more durable fix.
