> **kind:** FINDING

## `lastFlowDataTimestamp` in `flow-data-freshness.ts` is a dead-on-arrival export — REMOVED

| | |
|---|---|
| **Area** | `src/lib/flow-data-freshness.ts` — UW flow-liveness staleness bookkeeping |
| **Status** | FIXED (dead-code removal) |
| **Severity** | P4 (no behavior change; code-health/clarity cleanup) |

### Root cause

`flow-data-freshness.ts` keeps a single module-level `lastFlowDataAt` timestamp, updated by
`markFlowDataFresh()` and consumed by `flowDataAgeMs()`/`resolveFlowDataAgeMs()` to answer "how
stale is the UW flow tape." Alongside the real age-returning accessor (`flowDataAgeMs`), the file
also exported a second, raw accessor:

```ts
export function lastFlowDataTimestamp(): number | null {
  return lastFlowDataAt;
}
```

A repo-wide search (`grep -rn "lastFlowDataTimestamp" .` across `*.ts`/`*.tsx`/`*.mjs`/`*.cjs`)
turns up exactly **one** hit: the export's own definition. It is imported by no application code,
no admin/health route, no script, and not even by the module's own `flow-data-freshness.test.ts`
(which exercises `markFlowDataFresh`, `newestFlowAgeMsFromBriefs`, and `resolveFlowDataAgeMs`, but
never this function). `flowDataAgeMs` — the sibling that actually derives the *age* from the same
private variable — IS consumed, both internally (`resolveFlowDataAgeMs`) and would be externally
importable; `lastFlowDataTimestamp` never was.

Traced via `git log --all -S"lastFlowDataTimestamp" -- src/lib/flow-data-freshness.ts`: it entered
in a single large June 2026 commit (`30fb7991c`, "Harden SPX platform reliability and add Sniper
Terminal live feed") that shipped the whole flow-liveness/health-monitoring surface in one pass.
Everything else that commit added to this file (`markFlowDataFresh`, `flowDataAgeMs`) is live and
wired; this one raw-timestamp accessor was added alongside them but never got a caller — a
textbook "dead on arrival" sibling to an otherwise-used feature, not a case of later-superseded
code or intentional WIP (no flag, no TODO, no comment pointing at a planned consumer).

### Evidence

Pre-fix, on `origin/main` (`d0e00f09c`):
```
$ grep -rn "lastFlowDataTimestamp" . --include="*.ts" --include="*.tsx" --include="*.mjs" --include="*.cjs"
./src/lib/flow-data-freshness.ts:71:export function lastFlowDataTimestamp(): number | null {
```
One hit — the definition itself. No caller in `src/`, no script, no test.

Post-fix: the same grep returns nothing. `npx tsx --experimental-test-module-mocks --test
src/lib/flow-data-freshness.test.ts` (Node 20): 3/3 pass, unchanged. Sibling consumers'
regression tests also re-run clean: `src/lib/flow-persist.test.ts` + `src/lib/flow-liveness.test.ts`
→ 23/23 pass, 0 fail. `npx tsc --noEmit` on the whole project: clean. `npx eslint
src/lib/flow-data-freshness.ts`: clean.

Because this is a zero-reference deletion (not a logic change), the RED→GREEN proof here is the
grep itself rather than a flipped assertion — removing a function with a live caller would show up
immediately as a TypeScript compile error on that caller, and `tsc --noEmit` staying clean after
the removal is the confirmation that no such caller exists anywhere in the TypeScript program.

### Blast radius

Single-file change. `lastFlowDataAt` (the private module variable) is untouched and still written
by `markFlowDataFresh` and read by `flowDataAgeMs` exactly as before — only the unused extra public
accessor is gone. No import site anywhere in `src/`, `scripts/`, or `docs/` referenced it, so there
is nothing else to update.

### Fix rationale

Delete the dead export rather than keep it "for future use" — it carries no flag, no comment
describing an intended consumer, and duplicates `flowDataAgeMs()`'s information in a strictly less
useful (unconverted, no staleness semantics) form, so a future caller wanting the raw stamp would
more naturally just read `flowDataAgeMs()`'s age or add a fresh accessor scoped to its actual need
rather than resurrect this one. Left `flowDataAgeMs`, `markFlowDataFresh`,
`markFlowDataFromBriefs`, `newestFlowAgeMsFromBriefs`, and `resolveFlowDataAgeMs` completely
unchanged — all five are genuinely wired (confirmed via import-site grep) and none of this finding
touches their behavior.
