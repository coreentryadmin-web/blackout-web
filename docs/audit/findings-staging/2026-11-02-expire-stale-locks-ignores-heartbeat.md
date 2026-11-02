> **kind:** FINDING

## Autopilot task-lock watchdog can steal a task from a still-working agent — FIXED

| | |
|---|---|
| **Area** | `scripts/blackout-agent/lib/locks.mjs` (Claude↔Cursor autopilot task-claim/lease system) |
| **Status** | FIXED — regression test added, RED→GREEN proven via `git stash` |
| **Severity** | P2 (data-integrity race in the autopilot coordination layer, not member-facing) |

### Root cause

`claimLock()` implements a deliberate, explicitly-commented safety rule: an expired
lease is only reclaimable by another agent when the recorded owner's **heartbeat**
is also stale —

```js
// Lease expired — reclaim ONLY if the recorded owner's heartbeat is stale.
// A slow-but-alive agent renewing heartbeat must not be stolen from.
if (!isOwnerHeartbeatStale(existing.owner)) {
  return { ok: false, reason: "lease_expired_owner_alive", lock: existing };
}
```

This invariant is already covered by an existing test
(`claimLock: expired lease NOT reclaimed when owner heartbeat is fresh`).

But the SAME file's `expireStaleLocksSync()` — called by `watchdog.mjs` ("expire
task leases") and by `sync-context.mjs`'s `syncContext()` (invoked from
`handoff.mjs` on every session handoff) — swept every lock whose `lease_until` had
passed **unconditionally**, with no heartbeat check at all:

```js
if (Date.parse(lock.lease_until) <= Date.now()) {
  unlinkSync(lockPath(taskId));   // deleted regardless of owner heartbeat
  expired.push(taskId);
}
```

So the one-and-only safety check `claimLock` exists to enforce was bypassed
entirely by the periodic sweeper that runs independently of any claim attempt.

### Evidence

Concrete failure scenario: Agent A claims `BO-P1-XYZ` with the default 90-minute
lease and keeps working past that window while its heartbeat stays fresh (it is
still actively running, just on a long task). At the next `watchdog.mjs` run (or
the next `handoff.mjs`/`syncContext()` call — both of which fire routinely during
normal autopilot operation), `expireStaleLocksSync()` deletes Agent A's lock file
purely because `lease_until <= now`, with zero regard for Agent A's live
heartbeat. Agent B can now successfully `claimLock()` the same task id while
Agent A is still mid-implementation — a double-claim / work-stealing race on the
exact resource this lease+heartbeat system was built to serialize.

Added two regression tests to `scripts/blackout-agent/blackout-agent.test.mjs`:
- `expireStaleLocksSync: does NOT delete an expired lease whose owner heartbeat is
  fresh` — FAILED before the fix (`actual: false` where `true` expected — the
  lock WAS swept despite a fresh heartbeat), PASSED after.
- `expireStaleLocksSync: DOES delete an expired lease whose owner heartbeat is
  stale` — passed both before and after (confirms the fix doesn't regress the
  legitimate reclaim path).

Proven RED→GREEN via `git stash push -- scripts/blackout-agent/lib/locks.mjs`
(fail: 1) → `git stash pop` (fail: 0, 21/21 pass).

### Blast radius

Both call sites are live in normal autopilot operation, not just test/manual
paths:
- `scripts/blackout-agent/watchdog.mjs` — its entire stated purpose per its own
  header comment is "mark stale agent heartbeats unhealthy; expire task leases",
  i.e. it is explicitly meant to key lease expiry off heartbeat staleness and
  previously didn't.
- `scripts/blackout-agent/sync-context.mjs`'s `syncContext()`, which
  `scripts/blackout-agent/handoff.mjs` calls on every handoff.

No other call sites exist (`grep -rn "expireStaleLocksSync"` across `scripts/`).

### Fix rationale

Reused the exact predicate `claimLock` already uses for the identical decision —
`isOwnerHeartbeatStale(lock.owner)` — rather than inventing a second heartbeat-
staleness rule that could drift from the first. The function now only unlinks a
lock when BOTH the lease has expired AND the owner's heartbeat is stale, matching
the invariant the module's own `claimLock` comment states and the existing
`claimLock` test already encodes — this sweeper is simply the periodic-cleanup
mirror of that same rule, and now actually enforces it. Nothing else in the
sweep loop (iteration, `ensureLocksDir`, return shape) changed.
