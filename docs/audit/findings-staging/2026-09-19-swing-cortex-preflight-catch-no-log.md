> **kind:** FINDING

## `evaluateSwingCortexForCommit`'s fail-closed catch swallowed the thrown error with no CloudWatch log line — FIXED

| | |
|---|---|
| **Status** | FIXED (PR TBD) |
| **File** | `src/lib/swing/v2/cortex-swing.ts` (~L84-97) |
| **Severity** | P3 — observability gap, not a functional bug |

### What was wrong

`evaluateSwingCortexForCommit` (Swing G-S14 Cortex preflight, called once per Tier-1
candidate from `discovery.ts`'s commit path) wraps its `evaluate(...)` call in a
`try { ... } catch (err) { ... }` that fails closed correctly — it returns
`swingCortexUnavailableResult(...)` carrying the caught error's message in `reason`, which
blocks the commit via the `gate:G-S14:cortex_unavailable` token — but the catch block
itself never wrote anything to CloudWatch. The caller (`discovery.ts`, line ~1073) only
records `pre.blockedBy` into `c.preflightV2BlockedBy`; it never logs `pre.reason` either.
So a real production throw here (a Vector/Cortex upstream timeout, a malformed response,
etc.) was observable ONLY by reading the DB-pinned per-candidate block token after the
fact — zero trace of *why* it threw at the moment it happened, unlike its sibling catch in
the same `v2/` directory: `tier0-origin-fetch.ts`'s catch (L22-25) sets an equivalent
`fetchError: true` flag **and** logs `console.warn(...)` with the caught error. The Cortex
preflight catch was the one missing the log line.

### Why it wasn't caught earlier

Same shape as the two catches fixed earlier today in `zerodte/scan.ts` and
`swing/discovery.ts` (#5249/#5250): a catch that correctly sets a fail-closed
error/degraded flag reads as "handled" at a glance, because the return value is a
well-formed result object with a descriptive `reason` string baked in. The bug is not in
the return value — it's the missing side-channel trace that would let an operator
distinguish "Cortex genuinely vetoed this ticker" from "Cortex preflight infrastructure is
throwing" without correlating DB rows after the fact. Found by a direct sibling-comparison
sweep of every `catch (` block across `src/lib/swing/v2/*.ts`.

### Fix

Added one `console.warn` inside the existing catch, naming the ticker/direction and the
fail-closed effect, with the caught error attached — no behavior change: the fail-closed
`swingCortexUnavailableResult(...)` return and its message text are untouched. Matches the
exact logging shape already used by `tier0-origin-fetch.ts`'s sibling catch a few files
over.

### Evidence

- New regression test `evaluateSwingCortexForCommit: thrown error is logged, not silently
  swallowed` (`src/lib/swing/v2/cortex-swing.test.ts`) — stashed the fix and confirmed RED
  (`0 !== 1`, no `console.warn` call recorded) before restoring it and confirming GREEN
  (6/6 tests in the file pass).
- `npx tsc --noEmit -p tsconfig.json`: clean.
- Full suite: `npm test` — 14869 pass / 0 fail / 3 skipped (Node 20, `/opt/node20/bin`).
- CloudWatch `/ecs/blackout-production` grepped for `TypeError|Unhandled|undefined` over
  the last 15 min (2026-09-19, Saturday, market closed): 0 matches — no active incident,
  this is a proactive consistency fix, not a response to an observed outage.

### Blast radius

None beyond this one catch block. `evaluateSwingCortexForCommit` has exactly one call
site (`discovery.ts` L1072, read-only, not modified by this PR per this session's standing
instruction not to touch `scan.ts`/`discovery.ts`/`question-intent.ts` again today) and
`swingCortexUnavailableResult` is a pure helper reused only inside this same file.
