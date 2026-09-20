## `guardCheckedOutClient` added a fresh 'error' listener on every pool checkout, leaking one permanently per recycled client — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Status** | FIXED |
| **Area** | `src/lib/db.ts` (`guardCheckedOutClient`), called at every `pool.connect()` site in the file |

### How found

Live CloudWatch Logs sweep (`/ecs/blackout-production`, DISCOVERY-lane hourly cycle) turned up a
single, previously-unseen warning line:

```
(node:1) MaxListenersExceededWarning: Possible EventEmitter memory leak detected. 11 error
listeners added to [Client]. MaxListeners is 10. Use emitter.setMaxListeners() to increase limit
```

Surrounding context showed it fired immediately after an Ask Largo tool-loop turn that made 4
DB-backed tool calls (`get_wall_dynamics`, `get_gex_matrix_changes`, `get_gex_heatmap`,
`get_positioning`) — each of which checks out a Postgres pool client.

### Root cause

`guardCheckedOutClient(client)` — called at every one of the 7 `pool.connect()` call sites in
`db.ts` specifically to prevent an unguarded checked-out client's `'error'` event from escaping as
an uncaught exception (a real, previously-fixed CloudWatch `uncaughtException` incident) — called
`client.on("error", ...)` unconditionally, with no de-duplication.

`pg-pool` does not construct a fresh `Client` object on every `pool.connect()`; it recycles idle
clients from its internal pool. So the SAME physical client object gets checked out repeatedly
over the life of the ECS process, and every one of those checkouts that happened to route through
`guardCheckedOutClient` added ANOTHER permanent `'error'` listener to that same object — the
previous listener from the prior checkout was never removed. This is unbounded growth over the
life of the process, not a one-time cost: given a small pool (`max` connections) under sustained
traffic, any individual client will eventually be checked out enough times to cross Node's default
10-listener warning threshold, exactly as observed live (11 listeners on one client).

### Fix

Added a `Symbol.for("blackout.db.checkedOutClientGuard")` marker set on the client the first time
it is guarded; `guardCheckedOutClient` now checks the marker and returns early (no new listener)
on every subsequent call for the same physical client object. The guard behavior itself — swallow
and log the client's own `'error'` event — is unchanged and still installed exactly once per
client for the life of that client object, which is all it ever needed to be.

### Blast radius

One function, one file. All 7 `pool.connect()` call sites in `db.ts` benefit automatically since
they all route through the same `guardCheckedOutClient` helper — no call site changes needed.

### Fix rationale

A marker property is the minimal fix: it makes the existing guard idempotent per physical client
without changing its behavior, its call sites, or its signature. Considered and rejected: removing
the previous listener before adding a new one (`client.removeAllListeners("error")` then re-add) —
functionally equivalent here since the swallow-and-log body never varies, but strictly more code
for no behavioral difference, and marginally riskier if a future caller ever wants a
client-specific handler.

### Verification

New test `guardCheckedOutClient: guarding the SAME physical client object twice adds only ONE
'error' listener` (`src/lib/db.test.ts`). RED→GREEN proven: stashed the fix, re-ran — the test
failed (`expected: 1, actual: 3` after 3 guard calls on one client, reproducing the live
accumulation). Restored the fix: passes. Full `src/lib/db.test.ts` (37 tests) and `npx tsc
--noEmit` both clean. Full `npm test` run separately (Node 20) before merge.
