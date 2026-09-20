> **kind:** `FINDING`

## UW multiplex socket reconnect-storm off-hours — FIXED

| **Status** | Fixed (`fix/uw-socket-first-msg-grace-offhours`) |
|---|---|
| **Severity** | P3 — performance/resource-waste, no member-facing data loss |
| **Found by** | Standing 30-min coordinator cycle, step 8 (CloudWatch performance sweep) |
| **Date** | 2026-09-20 |

### Evidence

Live CloudWatch Logs, `/ecs/blackout-production-market-worker`, 2026-09-20 (a Sunday — fully
off-hours, no session, no RTH, no options market open at all):

```
14:09:19 [uw-socket] stall watchdog — OPEN 44s with ZERO messages, reconnecting (possible API-key contention)
14:09:20 [uw-socket] multiplex connected — joining channels
14:10:04 [uw-socket] stall watchdog — OPEN 44s with ZERO messages, reconnecting (possible API-key contention)
14:10:05 [uw-socket] multiplex connected — joining channels
... (identical pair, every ~44-45s, continuously)
20:07:34 [uw-socket] stall watchdog — OPEN 44s with ZERO messages, reconnecting (possible API-key contention)
```

Confirmed continuously present across a 6+ hour sampled window (14:09 UTC through 20:07 UTC when
found) with **zero exceptions** — every single reconnect cycle re-triggers the same "never
delivered any message" branch, never once receiving a message inside the grace window. At ~45s
per cycle that is roughly 480 reconnect attempts in the sampled window alone, and the pattern was
already running before the window started (first log line sampled was already mid-loop) and kept
running after — plausibly the entire weekend, since it is driven purely by "is the socket ever
sent a message," which off-hours (esp. a full weekend closure) can legitimately never happen.

### Root cause

`runUwReconcileTick()` (`src/lib/ws/uw-socket.ts`) already widens the **already-delivered-before**
stall window for off-hours:

```ts
const stallMs = inOptionsMarketHours() ? UW_SOCKET_STALL_MS : UW_SOCKET_STALL_OFFHOURS_MS; // 75s vs 5min
```

but passed the **never-delivered-yet** first-message grace unconditionally, always at the
RTH-tuned 30s constant (`UW_SOCKET_FIRST_MSG_GRACE_MS`), regardless of market hours:

```ts
uwSocket.reconnectIfStalled(freshestUwMessageAt(), stallMs, Date.now(), UW_SOCKET_FIRST_MSG_GRACE_MS);
```

`isUwSocketStalled()`'s "never delivered" branch (`src/lib/ws/uw-socket-stall.ts`) treats a
socket as dead once `now - openedAt > firstMsgGraceMs`, with no other signal. During RTH, 30s of
total silence right after connect is a real signal (UW silently accepting a duplicate API-key
connection and never sending data). Off-hours, sparse-to-zero traffic for far longer than 30s is
*expected*, not a fault — the code already knows this for the other branch, just not this one.

The result: the leader replica opens a socket, waits 30s (measured ~44s wall-clock including the
reconcile-tick cadence + teardown/reconnect overhead), sees nothing (expected, off-hours), tears
down, reconnects, and repeats — forever, every cycle landing back in the same "never delivered"
branch because a fresh reconnect always starts at `freshest == null` again. The log's own
"(possible API-key contention)" guess is backwards: the reconnect *churn itself* is the most likely
source of any real API-key contention with UW's single-connection-per-key limit, not a symptom of it.

### Blast radius

Single call site (`runUwReconcileTick`, one call to `reconnectIfStalled`) — no other caller passes
`firstMsgGraceMs`, confirmed via repo-wide grep. No duplicated logic elsewhere to fix.

### Fix

Mirror the existing RTH/off-hours split that `stallMs` already has, for `firstMsgGraceMs` too:
added `UW_SOCKET_FIRST_MSG_GRACE_OFFHOURS_MS = 5 * 60_000` (same 5-minute off-hours width as
`UW_SOCKET_STALL_OFFHOURS_MS`, for consistency) and select it in `runUwReconcileTick()` the same
way `stallMs` is already selected. Off-hours, a socket now gets a genuine 5 minutes of silence
before being torn down instead of 30 seconds — enough for the reconnect-storm to stop while still
recovering within a bounded time if the socket really is dead (duplicate-key silent-accept, a
network partition, etc.).

### Why this fix and not an alternative

- Considered: skip opening the UW socket entirely off-hours. Rejected — the price channel is
  documented (in the very comment this fix sits next to) as still delivering some off-hours
  traffic, and a fully-closed socket would need a separate reconnect-on-RTH-start path; reusing
  the existing grace-period lever is smaller and consistent with how the "has delivered" branch
  already handles the same RTH/off-hours distinction.
- Considered: raise `UW_SOCKET_FIRST_MSG_GRACE_MS` itself (one constant, no branch). Rejected —
  that would blunt the RTH duplicate-key detection this constant exists for (30s IS meaningful
  signal during RTH — see the constant's own doc comment), trading a real RTH fault-detection
  case away to fix an off-hours-only symptom.
- Deliberately left unchanged: the RTH grace period, the RTH/off-hours stall-window split, and the
  reconnect/backoff mechanics themselves — this is a single boundary-value fix, not a redesign of
  the watchdog.

### Regression test (RED→GREEN proven)

`src/lib/ws/uw-socket-stall.test.ts` — added 3 tests exercising the exact 44s-open scenario from
the live log line: RTH grace treats it as stalled (existing behavior, unchanged), off-hours grace
does not (new), and the off-hours grace still fires once genuinely exceeded (6 min). Verified RED
pre-fix (`git stash` on the two source files, same test file): 2/20 fail (missing export). GREEN
post-fix: 20/20 pass. Full `npx tsc --noEmit` clean.

### Market-open validation

See `docs/audit/MARKET-OPEN-VALIDATION.md` — added an entry to check the live CloudWatch log
pattern no longer shows the tight ~45s reconnect loop during the next off-hours window (evening or
weekend) after this deploys, and that RTH stall detection is unaffected during the next session.
