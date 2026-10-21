> **kind:** FINDING

## SPX Slayer: degraded-fallback path hardcoded `session_phase: "closed"`, misreporting the member-facing CLOSED badge during live RTH — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 — member-facing false "market closed" signal during real RTH |
| **Found** | 2026-10-21, 5-engine live-monitor cycle, live repro ~11:34 ET on `GET /api/market/spx/play` |
| **Fixed in** | `src/features/spx/lib/spx-service.ts`, `src/app/api/market/spx/play/route.ts` |

### Root cause

`degradedPlayPayload()` (`spx-play-payload.ts`) is the safe fallback returned whenever the SPX
play-eval pipeline fails to produce a result in time (a `ServerCacheTimeoutError`, lost
cross-replica lock, stale-cache miss with no peer snapshot). It hardcodes
`session_phase: "closed"` as part of its placeholder shape.

A 2026-10-16 fix (see `route.ts`'s existing header comment) already established that this
pipeline failing is **not evidence the desk/session is actually closed** — it corrected the
degraded payload's `headline`/`idle_message` text, which previously falsely asserted "Desk
warming." That fix only touched the text fields; `session_phase` kept the same false default.

`session_phase` is read directly by `spx-play-verdict-bar.ts`'s `resolveMode()`:

```ts
if (!sessionActive || play?.session_phase === "closed") return "closed";
```

So any degraded response — regardless of why the real market session is actually open — makes
the member-facing SPX Slayer verdict badge show **CLOSED**.

### Live repro

`GET /api/market/spx/play` at 2026-10-21T15:34:32Z (11:34 ET, an ordinary trading Wednesday):

```json
{
  "available": false,
  "assessed": false,
  "headline": "Play scan still catching up — retry shortly",
  "gates": { "passed": false, "blocks": [] },
  "session_phase": "closed",
  "degraded": true
}
```

A parallel `GET /api/market/spx/desk` call at the identical instant:

```json
{ "market_open": true, "market_status": "open", "market_label": "RTH OPEN", "price": 7746.22 }
```

A re-fetch of `/api/market/spx/play` ~2 minutes later returned a normal, fully-assessed payload
(`available: true`, `session_phase: "cash"`) — confirming this was the known transient
degraded-fallback path, not a persistent outage, and that the desk itself was never actually cold.

### Fix

Two call sites built `degradedPlayPayload()` without a real `session_phase`, both reachable
during genuinely open market hours:

1. `route.ts`'s `catch` block (the `ServerCacheTimeoutError` branch, same site the 2026-10-16 fix
   touched for the headline).
2. `spx-service.ts`'s `spxPlayReadDegraded()` — reached independently via
   `evaluateSpxPlayStateCrossReplica` (lost Redis lock, no stale/peer snapshot) and
   `spxPlayReadFallback` (stale-cache miss, no peer) — neither goes through `route.ts`'s catch at
   all, so the 2026-10-16 fix never covered this path either.

Both now peek the desk via `peekMergedSpxDesk()` — already proven fast/non-blocking even when
the expensive play-eval path itself times out (see finding #398 in
`docs/audit/MARKET-OPEN-VALIDATION.md`) — and derive the real phase via `currentSessionPhase()`,
the same function every non-degraded code path already uses. `degradedPlayPayload()`'s own bare
default is left untouched (existing unit tests construct it with no args and don't assert on
`session_phase`), so this is purely additive at the two real call sites.

### Evidence

- RED: added two source-inspection regression tests (matching this file's existing convention
  for `spx-service.ts`/`route.ts`, which depend on Redis/cache layers not easily mockable at the
  unit level) asserting `peekMergedSpxDesk`/`currentSessionPhase` appear in both fixed call
  sites — failed before the fix.
- GREEN: same tests pass after the fix; full `spx-service.play.test.ts` (13 tests),
  `spx-play-payload.test.ts`, `spx-play-verdict-bar.test.ts`, and
  `spx-service-cross-replica-lock.test.ts` (21 tests total) all pass, including the runtime
  cross-replica-lock test that actually exercises the now-`async spxPlayReadDegraded()`.
- `npx tsc --noEmit -p .` clean.

### Blast radius

Only these two sites construct `degradedPlayPayload()` in production code; the two existing bare
`degradedPlayPayload()` test calls are unaffected (no `session_phase` assertion). Largo's
`get_spx_play` and the BIE `spx_full_state` bundle both read from the same `getSpxPlayState()`
derivation this fixes, so they benefit too.
