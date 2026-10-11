## Largo `isRegularHours` — dead export — FIXED

> **kind:** `FINDING`

| **Status** | Fixed in PR (fix/largo-temporal-dead-exports) |
|---|---|

**Symptom:** none live — pure dead code found during a routine DISCOVERY-lane sweep, not a
production defect.

**Root cause:** `isRegularHours` (`src/lib/largo/temporal/timeframe.ts`) checked whether an instant
falls inside RTH on a weekday. Unlike its siblings `etTimeOnDay`/`sessionOpenMs`/`sessionCloseMs`/
`previousWeekday` — each of which is called internally by the live `resolveTimeframe`/`RULES`
machinery even though nothing outside this file imports them directly — `isRegularHours` has no
internal caller either: it is not referenced anywhere in `timeframe.ts` itself, only in its own
direct unit test.

**Evidence:** `grep -n "isRegularHours(" src/lib/largo/temporal/timeframe.ts` → only the
definition, before the fix (no internal call site, unlike the siblings checked alongside it).
`grep -rwn "isRegularHours" --include=*.ts --include=*.tsx src scripts` → only the definition and
its own test, before the fix.

**Fix:** Removed `isRegularHours`. Removed its import and its one direct test from
`timeframe.test.ts` — `etTimeOnDay`/`sessionOpenMs`/`sessionCloseMs`/`previousWeekday`/
`nowTimeframe`, all confirmed to be internally wired into the live `resolveTimeframe` RULES engine
(and separately unit-tested for that reason, matching the file's own stated testing philosophy —
"EVERYTHING IS EXPLICIT-`now`... cannot be tested at a boundary"), are untouched.

**Fix rationale:** Pure deletion — scoped to the one sibling with no live call path, internal or
external, unlike every other export checked in the same pass.

**Blast radius:** `src/lib/largo/temporal/timeframe.ts`,
`src/lib/largo/temporal/timeframe.test.ts` only.

**Regression guard:** `timeframe.test.ts` 19/19 pass (Node 20, `--experimental-test-module-mocks`).
`tsc --noEmit` clean.
