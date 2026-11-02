> **kind:** FINDING

## Autopilot `AGENT_STATE.json` writers that bypass `withStateLock` can silently erase a concurrent locked update — FIXED

| | |
|---|---|
| **Area** | `scripts/blackout-agent/{release-task,handoff,sync-context}.mjs` (Claude↔Cursor autopilot shared-state coordination layer) |
| **Status** | FIXED — regression tests added, RED→GREEN proven via `git stash` |
| **Severity** | P2 (data-integrity race in the autopilot coordination layer, not member-facing) |

### Root cause

`scripts/blackout-agent/lib/state-lock.mjs`'s `withStateLock()` exists specifically to serialize
read-modify-write access to the single shared `.blackout-agent/AGENT_STATE.json` file, and
`claim-task.mjs`/`record-review.mjs`/part of `pr-feedback.mjs` correctly wrap their mutations in
it. But a file lock only protects writers that actually participate in the protocol — and three
other call sites mutated the exact same shared file with a plain, unlocked
`readAgentState()` → mutate → `writeAgentState()`, with no call to `withStateLock` at all:

- **`release-task.mjs`** — read state, flipped `state.tasks[taskId].phase` to `"RELEASED"`,
  appended an event, wrote back. No lock.
- **`handoff.mjs`** — reused the `state` object `syncContext()` had already returned (itself read
  well before this point), appended a `"handoff"` event, wrote back. No lock.
- **`sync-context.mjs`'s `syncContext()`** — the worst of the three: it read `state` at the very
  TOP of the function, then did several seconds of `gh`/network I/O (`git rev-parse`, a `gh run
  list` call, and `fetchOpenPrsAsync()` — whose REST fallback issues one additional `check-runs`
  HTTP call *per open PR*, per that function's own comment on why the fallback exists), and only
  THEN wrote the now-stale `state` object back, unconditionally and unlocked.

Because an unlocked writer always "succeeds" regardless of what a locked writer is doing, any
`claim-task.mjs`/`release-task.mjs`/`record-review.mjs` update that landed on disk *during* one
of these functions' multi-second window — a perfectly normal timing in a system explicitly
designed so Claude and Cursor sessions claim/release tasks concurrently — was silently wiped the
moment the stale snapshot got written back on top of it. `syncContext()` is not an edge case:
`bootstrap.mjs`, `select-task.mjs`, and `session-start.mjs` all call it on every bootstrap, and
`handoff.mjs` calls it on every session handoff, so this window opens routinely during normal
autopilot operation, not just under adversarial concurrency.

Concrete failure scenario: agent A's task-claim lands via `claim-task.mjs` (correctly
`withStateLock`-protected) at the exact moment agent B's `handoff.mjs` is mid-flight inside its own
`syncContext()` call, which read state several seconds earlier and hasn't written yet. When B's
`syncContext()`/`handoff.mjs` finishes, it writes its stale pre-claim snapshot back over A's claim
— `state.tasks` now disagrees with the real `.lock` file on disk for that task, so anything that
trusts `state.tasks` (a bootstrap report, a dashboard, future coordination logic) sees the task as
unclaimed even though it is actively locked.

### Evidence

- New regression test `releaseTaskInState: respects the shared state-write lock instead of
  writing unlocked` (`scripts/blackout-agent/blackout-agent.test.mjs`): while the shared state
  lock is held by a different owner, the newly-exported `releaseTaskInState()` must come back
  `{ ok: false, reason: "state_lock_held" }` rather than writing anyway. RED pre-fix:
  `releaseTaskInState` did not exist (`release-task.mjs` had no exported, lock-aware function to
  call), so the whole test file failed to even load. GREEN post-fix.
- New regression test `syncContext: a task claimed while this call's own fetch is in flight
  survives its final write` exercises the REAL race, not a simulation of it: `syncContext()` is
  called without awaiting, runs synchronously up to its first `await` (inside
  `fetchOpenPrsAsync()`) and yields — exactly the window the bug lived in — then a task is claimed
  via the same lock-respecting path `claim-task.mjs` uses, and only then is the pending promise
  awaited. Post-fix, the claim is still present in `AGENT_STATE.json` afterward.
- Full file: `npx tsx --experimental-test-module-mocks --test
  scripts/blackout-agent/blackout-agent.test.mjs` — 26/26 pass post-fix. Proven RED→GREEN via
  `git stash push -- scripts/blackout-agent/{handoff,release-task,sync-context}.mjs` (fails to
  load: `releaseTaskInState` not exported) → `git stash pop` (26/26 pass).
- Full `npm test` run clean on this branch (Node 20).

### Blast radius

All three call sites share one root cause (the same missing-lock pattern, not three independent
bugs) and are fixed together per this repo's "duplicated logic in a second file counts — fix and
note all of them" policy:

- `release-task.mjs` — its state mutation now lives in an exported `releaseTaskInState(taskId,
  owner)` wrapped in `withStateLock`; the CLI entry point is unchanged behaviorally (still exits
  2/3 on failure, same JSON output on success).
- `handoff.mjs` — its final `appendEvent`/`writeAgentState` now re-reads state fresh inside
  `withStateLock` right before writing, instead of reusing the stale object `syncContext()`
  returned earlier. On lock contention it now logs a warning and still completes (the handoff
  markdown files, its primary job, are already written by that point) rather than silently losing
  the `"handoff"` event.
- `syncContext()` — restructured so every slow `gh`/network call happens BEFORE entering the
  locked critical section; the merge-and-write step re-reads `readAgentState()` fresh from inside
  `withStateLock`, so it can only ever merge onto the current on-disk state, never clobber it with
  a pre-fetch snapshot. On lock contention it skips writing this cycle (best-effort — the next
  sync/claim/release retries normally) rather than blocking indefinitely or racing the holder.
- Not touched: `claim-task.mjs`, `record-review.mjs`, `pr-feedback.mjs`'s locked branch — all
  already correctly used `withStateLock`, confirmed by `grep -l "writeAgentState"
  scripts/blackout-agent/*.mjs` cross-checked against `grep -l "withStateLock"` over the same set.
  `watchdog.mjs` was also checked and does not call `syncContext()`/`writeAgentState` at all (it
  only touches per-agent heartbeat files via `writeJsonAtomic`, a different, single-file write
  with no shared-state read-modify-write to race).

### Fix rationale

Kept the exact same `withStateLock` protocol every other writer already uses, rather than
inventing a second locking scheme — the bug was inconsistent *participation* in an otherwise
correct design, not a flaw in `withStateLock`/`locks.mjs` itself. For `syncContext()`
specifically, deliberately moved the slow I/O OUTSIDE the lock rather than holding the lock for
the whole multi-second fetch: the lock's default TTL is 30s and a REST-fallback-heavy sync can
plausibly exceed that, so holding it the whole time would either block every other writer for
seconds at a time or risk the lock's own TTL expiring mid-operation — re-reading fresh state in a
short critical section after the I/O is done gets the same correctness without that cost.
Deliberately left `bootstrap.mjs`/`select-task.mjs`/`session-start.mjs` untouched: they only
*consume* `syncContext()`'s return value (`{ state, expired, activeLocks }`), whose shape is
unchanged by this fix.
