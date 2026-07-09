# Incident report — 0DTE Command degraded plays, 2026-07-07 → 2026-07-08

**Status:** Investigated end-to-end at the code level (full read of the WS init/leader-lock call
chain — `init-data-sockets.ts`, `uw-socket.ts`, `polygon-socket.ts`, `leader-lock-fencing.ts`,
`leader-lock-shared.ts`). Root cause narrowed to three specific, independently-plausible code
paths (below), none provably THE trigger without AWS CloudWatch/ECS runtime logs, which this
sandbox cannot reach. No fix applied — this is a report only, per explicit instruction not to
push any changes.

**Reported by:** user, live during 2026-07-08 RTH ("0dte plays failed today too .. yesterday
also failed"). Investigated same session.

---

## Summary

Every Unusual Whales WebSocket channel, and the Polygon indices WebSocket, are **down
fleet-wide** during live market hours on 2026-07-08. This is not a 0DTE-specific bug — it is a
site-wide real-time-data outage that happens to surface most visibly in 0DTE Command because its
scanner still runs (off REST), but silently degrades several of its scoring fields to `null` for
tickers that would otherwise be enriched from the dead WebSocket-fed caches.

The timing coincides with the Railway → AWS (ECS/Fargate + RDS) migration that landed in the
prior session (PR #682, #685, #686 — see `FINDINGS.md`), which the user confirmed today
("I migrated from railways to aws"). The most likely trigger is a fragile initialization
sequence in `src/lib/ws/init-data-sockets.ts` that has probably never been exercised under a
real failure before, because it likely never had reason to fail on Railway.

## Live evidence (pulled via authenticated admin session against `https://blackouttrades.com`,
during regular trading hours, 2026-07-08 ~11:05 AM ET)

### `/api/admin/zerodte/health` — scanner itself reports healthy
```json
{
  "scan": { "status": "healthy", "age_min": 4, "stale_after_min": 15 },
  "candidates_scanned": 5,
  "committed_count": 5,
  "rejected_count": 0
}
```
The scanner is not crashing and is producing candidates — this masked the underlying outage from
a shallow health check.

### `/api/market/zerodte/board` — setups missing WS-fed enrichment
Live setups for SPXW and SPY had `dossier_score`, `conviction`, `factor_breakdown`,
`gex_king_strike`, `gamma_regime`, and `dark_pool_bias` all `null`. TSLA, pulled in the same
response, had all of those fields populated. This is the concrete, member-visible symptom: some
0DTE setups render as thin/low-conviction plays with no explanation, depending on what happened
to be cached before the outage began.

### `/api/admin/health` — every WS channel confirmed down, fleet-wide
```json
"websockets": {
  "polygon_indices": {
    "authenticated": false,
    "wsState": "NOT_CREATED",
    "consecutiveFailures": 0,
    "symbols": [
      { "sym": "I:SPX", "price": 0, "ageMs": null },
      { "sym": "I:VIX", "price": 0, "ageMs": null }
      // ...all indices: price 0, ageMs null (never ticked)
    ]
  },
  "unusual_whales": {
    "configured": true,
    "initialized": false,
    "auth_failed": false,
    "channels": {
      "flow_alerts":      { "ws_state": "CLOSED", "authenticated": false, "handlers": 0, "last_error": null },
      "market_tide":      { "ws_state": "CLOSED", "authenticated": false, "handlers": 0, "last_error": null },
      "net_flow":         { "ws_state": "CLOSED", "authenticated": false, "handlers": 0, "last_error": null },
      "option_trades":    { "ws_state": "CLOSED", "authenticated": false, "handlers": 0, "last_error": null },
      "gex_strike_expiry":{ "ws_state": "CLOSED", "authenticated": false, "handlers": 0, "last_error": null }
      // ...all 10 channels identical: CLOSED, 0 handlers, no error, no auth failure
    },
    "stores": {
      "option_trades_total_received": 0,
      "lit_trades_total_received": 0,
      "gex_strike_expiry_cells": 0
      // every store: zero messages EVER received, not "was live then stopped"
    }
  },
  "options": { "total_contracts": 0, "shards": [] },
  "stocks_luld": { "initialized": false, "is_leader": false, "ws_state": "idle" }
}
```
Key detail: `configured: true` but `initialized: false`, `auth_failed: false`, every channel
`CLOSED` with **zero messages ever received** and **no recorded error**. This is not "connected
then died" (which would show non-null `last_message_age_ms`, `last_close_reason`, or
`last_error`) — it is "never successfully initialized," consistent across every channel and every
socket type (UW, Polygon indices, Massive options, stocks/LULD) simultaneously.

### Ruled out
- **Redis is healthy**: `redis_degraded: false`. `rate_limiters.uw.redisGlobal: true`,
  `degraded: false`. The Redis-backed cross-replica rate limiter and cache bridge are working —
  this is not a Redis outage.
- **`REPLICA_COUNT` is set correctly**: `rate_limiters.uw.replicaCount: 5` /
  `rate_limiters.polygon.replicaCount: 5`, matching the historical Railway topology
  (`iad=3, us-west2=2`). So the WS leader-lock fail-open/fail-closed policy
  (`src/lib/ws/leader-lock-shared.ts`) is reading a sane value, not silently defaulting to `1`
  because an env var was dropped in the migration.
- **UW's REST API is fine**: `provider_health.unusual_whales`: 52 calls/5min, 0 errors, all
  `last_ok: true`. Only the WebSocket layer is affected, not the account/API key itself.
- **`src/lib/ws/*.ts` was not touched** by the recent `feat: modular monolith feature folders`
  restructure commit (`681530b`) — this is not an import-path breakage from that refactor.

## Root-cause hypotheses (code-grounded, read end-to-end; ranked by plausibility)

I read the full call chain for both sockets line by line: `init-data-sockets.ts` →
`uw-socket.ts::initUwSocket()` / `polygon-socket.ts::initPolygonSocket()` →
`connectIndices()`/leader-election → `leader-lock-fencing.ts`/`leader-lock-shared.ts`. Three
distinct, independently-plausible failure mechanisms exist in this code; none is proven without
runtime logs, but they're ranked below by how well they fit the observed symptom.

### Hypothesis A (most likely): `ensureDataSockets()`'s init-attempted flag has no retry path

```ts
// src/lib/ws/init-data-sockets.ts
export function ensureDataSockets() {
  if (initialized) return;
  initialized = true;              // <-- set BEFORE any socket actually starts
  ...
  void initFlowEventBridge();      // async, first line is `await` — cannot throw synchronously, safe
  initUwSocket();                  // <-- NOT wrapped in try/catch
  initPolygonSocket();             // <-- NOT wrapped in try/catch
  ...
  try {
    initOptionsSocket();           // <-- these two siblings ARE wrapped
  } catch (err) { ... }
  try {
    initStocksSocket();
  } catch (err) { ... }
  ...
}
```

The `initialized` flag is an **"attempted," not "succeeded," guard**, set *before*
`initUwSocket()` / `initPolygonSocket()` run, and neither call is wrapped in try/catch (unlike
their two younger siblings, whose inline comments explicitly say they were wrapped "so an init
throw can't break the others" — meaning the codebase already knows this failure mode and
deliberately guarded against it for the *newer* two sockets, just not the original two). If
either `initUwSocket()` or `initPolygonSocket()` throws synchronously on its very first
invocation, the exception propagates up through `ensureDataSockets()` uncaught, but the
`initialized` flag is already `true` — so **every subsequent request forever after, for the
lifetime of that process, silently no-ops and never retries**. I checked `initUwSocket()`'s own
synchronous prefix — it early-returns cleanly if `UW_API_KEY` is unset (ruled out: live data
shows `configured: true`), then calls `startClusterFreshnessPoller()` and
`uwSocket.subscribe(...)` with no further guard. `initPolygonSocket()`'s prefix is thinner
(`void connectIndices(); startIndicesWatchdog();`) — see Hypothesis B for why `connectIndices()`
itself is less suspicious than it first looks.

**Compounding factor, confirmed independently of which hypothesis is right:**
`ops_config.discord_ops_webhook: false` in the live health payload — the ops Discord webhook is
unconfigured. So even in scenarios where this codebase's error paths *do* fire an alert (several
`try/catch` blocks throughout the WS layer call `notifyOpsDiscord`), that alert silently no-ops.
Combined with no visible crash (route handlers return 200 with degraded/null data by design) and
no retry, this is a failure mode with **zero built-in visibility** — which is consistent with the
outage apparently running through an entire trading day before a human noticed it via the UI.

### Hypothesis B (plausible, but I found evidence against the naive version): a leader lock stuck on a dead connection

My first pass assumed "leader lock stuck" meant a broken/unfenced renewal loop. Reading
`polygon-socket.ts::startIndicesLeaderRefresh()` line by line ruled that out — it correctly calls
`renewFencedLock()` (the same fencing-token-protected renewal used by `uw-socket.ts`, built to fix
a documented split-brain bug from an earlier audit), not a naive blind `SET`. So a stale lock
*should* self-expire within `INDICES_LEADER_TTL_SEC` (25s) if the holding process actually died.

The narrower, still-live risk: `startIndicesLeaderRefresh()`'s renewal only checks **token
ownership** (`renewFencedLock` returns whether this replica still legitimately holds the key), not
**WS health** (`indicesWs?.readyState === WebSocket.OPEN`). A replica whose process is alive but
whose actual WebSocket silently died (e.g., a TCP-level failure that doesn't reliably fire
`onclose`, plausible under different VPC/NAT/security-group behavior on the new AWS network vs.
Railway's) would keep winning its own TTL renewal every 10s forever, holding the lock while
serving zero data — and because it's still "the leader" by the lock's own accounting, no other
replica's `connectIndices()` call would ever be allowed to take over and try again.

Also worth noting for completeness: `connectIndices()`'s "not leader — skipping WS (reading Redis
snapshot)" path (line ~315) is **normal, expected behavior for 4 of 5 replicas** in a healthy
fleet — only one replica should ever hold the lock and open a real connection. I can't tell from a
single `/api/admin/health` pull (which replica answers is load-balancer-determined, not
something I control) whether the replica I queried is a normal non-leader or whether it's the
would-be leader hitting a deeper problem. The fact that **every UW store shows `total_received: 0`
with no age at all** (not just this replica's local read) is the stronger signal that no replica
anywhere is currently a healthy, connected leader — but confirming that needs either a second
independent poll (hoping to land on a different replica) or direct Redis/CloudWatch access.

### Hypothesis C (weaker, but consistent with a fresh migration): first-connection failure specific to the new network path

`REPLICA_COUNT=5` and `redis_degraded: false` both read correctly, ruling out the two most
obvious "config didn't carry over" explanations. But the underlying TCP/TLS handshake to UW's and
Polygon's WebSocket endpoints, and to `wss://socket.massive.com/options`, now originates from a
different network (AWS VPC/NAT/security groups) than whatever Railway used. If that egress path
has a security-group or NACL gap for outbound WSS on the relevant ports/hosts — plausible during a
fresh migration, easy to overlook since HTTP(S) REST egress (which UW/Polygon REST calls use, and
which is confirmed working) can be allowed while a longer-lived WebSocket upgrade is blocked by a
different rule — every replica's `connectIndices()`/`initUwSocket()` would hang or fail identically,
fleet-wide, matching the "nothing anywhere has ever received a message" pattern exactly.

**What would confirm or rule out each hypothesis:** an AWS CloudWatch log line for the
`blackout-web` service around a container's first `/api/market/*` request after startup —
specifically `[uw-socket]`, `[polygon-socket]`, and `[init-data-sockets]` prefixed lines, all of
which already exist in the code (`console.log`/`console.warn`/`console.error`), so the signal
should already be sitting in CloudWatch if any of these theories is correct. Pulling that log was
attempted this session but blocked by the sandbox's permission classifier as a sensitive
production-log read needing explicit user authorization; this sandbox also has no AWS CLI/
credentials configured, so there is no way to self-serve that confirmation from here even with
authorization — it would need to be run with real AWS credentials (read-only CloudWatch Logs +
ECS describe access would be sufficient) or by the user directly.

## Blast radius

Not 0DTE-specific. Anything that reads from the UW WS-fed stores or the Polygon indices store is
affected fleet-wide right now:
- **0DTE Command**: dossier scoring (`conviction`, `factor_breakdown`, `gex_king_strike`,
  `gamma_regime`, `dark_pool_bias`) silently `null` for tickers not already warm in a REST-backed
  cache.
- **HELIX** (flow alerts): `persistAndPublishFlowAlert` is fed by the `option_trades` WS channel
  — with 0 messages ever received, HELIX's live flow tape has nothing new to show.
- **Vector**: SPX candle aggregation depends on the same Polygon tick stream
  (`src/lib/ws/polygon-socket.ts` feeding `spx-candle-store.ts`) — `I:SPX price=0, never ticked`
  means Vector's live candle is not being fed either (though it has its own staleness/fallback
  guards from earlier fixes this session).
- Anything reading `indexStore["I:SPX"]`/VIX directly for a "live" read, site-wide.

## Suggested next steps (not actioned — report only)

1. **Get AWS CloudWatch logs** for `blackout-web` around a container's first `/api/market/*`
   request after startup, filtered for `[uw-socket]` / `[polygon-socket]` / `[init-data-sockets]`
   log-line prefixes — all three already exist in the code via `console.log`/`console.warn`/
   `console.error`, so whichever hypothesis is right should already be sitting in the logs.
   Needs either real AWS credentials handed to this session (read-only CloudWatch Logs +
   ECS describe access is sufficient — see the note above this section on how to hand them over
   safely) or the user pulling it directly.
2. **Directly inspect the Redis keys** `polygon:indices:leader` / the UW equivalent
   (exact key names are `INDICES_LEADER_KEY` in `polygon-socket.ts`, `UW_LEADER_KEY` in
   `uw-socket.ts`) — TTL remaining and current token value would immediately distinguish
   Hypothesis A (nobody ever holds the lock) from Hypothesis B (someone holds it, zombied). This
   sandbox cannot reach Redis directly (documented existing environment limitation, same as
   Postgres) — needs either a Railway/AWS-side shell or a temporary debug endpoint.
3. **If Hypothesis A is confirmed**: wrap `initUwSocket()` and `initPolygonSocket()` calls in the
   same try/catch pattern already used for `initOptionsSocket()`/`initStocksSocket()` in
   `ensureDataSockets()`, and separate the "attempted" flag from a real "succeeded" state so a
   failed init can retry on a later request instead of being permanently disabled for the
   process's lifetime.
4. **If Hypothesis B is confirmed**: have `startIndicesLeaderRefresh()` (and its UW equivalent)
   verify actual WS health (`readyState === OPEN`) before renewing the lock, not just token
   ownership — a replica whose connection silently died should release leadership rather than
   keep winning its own TTL renewal forever.
5. **If Hypothesis C is confirmed**: this is an AWS networking/security-group fix (outbound WSS
   egress to `api.unusualwhales.com`, Polygon's indices WS host, and
   `wss://socket.massive.com/options`), not a code fix — outside this repo's scope to resolve
   from here.
6. **Regardless of root cause**: `ops_config.discord_ops_webhook: false` means this entire class
   of failure currently has **no alerting path at all** — worth fixing independently (just set the
   webhook URL on the new AWS infra) so a repeat doesn't silently run through a full trading day
   again before a human notices from the UI.
7. **Short-term operational mitigation**, if the team wants the outage cleared before the code fix
   is prepared: manually restart/redeploy the `blackout-web` ECS service. If the trigger is a
   startup-time race/failure (Hypothesis A) rather than a persistent block (Hypothesis C), a fresh
   container may simply not hit it again, clearing the outage immediately — though it would
   recur on the next restart until the underlying code/network issue is actually fixed.
