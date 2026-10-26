## SPX Slayer: `flow_cluster_live` was sourced from a MARKET-WIDE "is any ticker's flow live" signal, silently disabling the stale-flow BUY-block and warning gates

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED (PR #TBD) |
| **Found by** | Two independent live-audit passes, Ask Largo × Night Hawk standing performance/correctness mandate, 2026-10-26 |
| **Scope** | `src/features/spx/lib/spx-desk.ts` (`deskFlowDataAgeMs`, both `flow_cluster_live` call sites), `src/features/spx/lib/spx-play-gates.ts` (the consuming stale-flow BUY-block/warning gate), `src/lib/flow-liveness.ts` (new scoped signal), `src/lib/flow-persist.ts` (write site) |

### Root cause

`deskFlowDataAgeMs` (`spx-desk.ts`) is SPX Slayer's "how old is our flow tape, honestly" function:

```js
function deskFlowDataAgeMs(flows, flowClusterLive) {
  markFlowDataFromBriefs(flows);
  let age = resolveFlowDataAgeMs(flows);
  if (flowClusterLive && age != null && age > 120_000) age = 120_000;
  return age;
}
```

The clamp's own stated intent (per the gate's consuming comment) is reasonable: tolerate a
replica whose own in-memory tape read is lagging, as long as SOME replica is demonstrably
delivering live WS frames for SPX right now. The bug is in what `flowClusterLive` actually
measured. Both call sites computed it as:

```js
const flowClusterLive = await isFlowFrameFreshAnywhere(120_000).catch(() => false);
```

`isFlowFrameFreshAnywhere` (`flow-liveness.ts`) reads ONE shared Redis key
(`flow_alerts:last_delivered_at`) with **no ticker filter at all** — it is `true` whenever ANY
ticker anywhere in the entire market had a flow alert persisted within the last 120s. The write
site (`flow-persist.ts`'s `persistAndPublishFlowAlert` → `markFlowFrameDelivered()`) is gated only
on dedup/fan-out logic, never on ticker identity or premium size tied to SPX.

Because options flow is being delivered *somewhere* in the market almost continuously during RTH
(and often after close), this signal is nearly always `true` — which means the clamp fired nearly
always, silently reporting a fresh `120_000`ms age for `flow_data_age_ms` even when SPX's own real
tape was far staler. That field is then consumed directly by `spx-play-gates.ts`:

```js
const flowAgeMs = desk.flow_data_age_ms;
const clusterLive = desk.flow_cluster_live === true;
if (buyIntent && flowAgeMs != null && flowAgeMs > 300_000 && !clusterLive) {
  blocks.push(`Flow data stale (${...}m) — tape and 0DTE signals unreliable`);
} else if (flowAgeMs != null && flowAgeMs > 120_000 && !clusterLive) {
  warnings.push(`Flow data ${...}m old — tape signal may lag`);
}
```

Both the BUY-block (>5 min stale) and the warning (>2 min stale) are gated on `!clusterLive`, so
with `clusterLive` almost always `true`, both protections were effectively unreachable whenever
SPX's own tape went genuinely stale while the rest of the market kept printing — which is the
common case, not an edge case.

### Evidence

- Live-confirmed (both audit passes, independently): `flow_data_age_ms` reported capped at
  `120000` while the real newest `alerted_at` across the desk's own `spx_flows[]` array was
  ~1,055,000ms (~17.6 min) old — a genuinely stale SPX tape read as "2 minutes old."
- `isFlowFrameFreshAnywhere`'s own write site (`flow-persist.ts:238` pre-fix,
  `markFlowFrameDelivered()`) is called for every persisted/published flow print above
  `MIN_PREMIUM`/`MIN_PREMIUM_NEAR_DATED` regardless of ticker — confirmed by reading the call site
  and its heartbeat key shape (`flow_alerts:last_delivered_at`, no ticker component).
- RED→GREEN regression proof (below): a test using the REAL flow-liveness functions reproduces
  the exact scenario — an unrelated ticker (`AAPL`) delivers a fresh print, `isFlowFrameFreshAnywhere`
  correctly reads `true` (unaffected, intentional for its other market-wide consumers), but
  `deskFlowDataAgeMs` fed that signal would have clamped a genuinely 400s-stale SPX tape down to
  `120_000`ms, suppressing the stale-flow BUY-block that should have fired.

### Blast radius

Both consumers in `spx-play-gates.ts` share the one `desk.flow_cluster_live` field, so the same
bug affected:
1. The **BUY-block** (`flowAgeMs > 300_000ms && !clusterLive`) — the harder protection, meant to
   stop new entries on a genuinely stale tape.
2. The **warning** (`flowAgeMs > 120_000ms && !clusterLive`) — the softer disclosure, meant to flag
   lag to the trader even when not hard-blocking.

Both call sites inside `spx-desk.ts` that compute `flowClusterLive` (the canonical `buildSpxDesk()`
path and the UW "flow lane" `buildSpxDeskFlow()` path) independently repeated the same
market-wide-signal mistake, so the fix had to land at both.

### Fix

Added a ticker-scoped sibling to the existing heartbeat architecture in `flow-liveness.ts`,
rather than discarding the clamp outright (see rationale below):

1. `isSpxFlowCohortTicker(ticker)` — true for `SPX`/`SPXW` (the UW tickers SPX Slayer's own tape
   already filters to — matches `spx-desk.ts`'s own existing `fetchSpxDeskFlowAlertsWithDb` DB
   filter, `t === "SPX" || t === "SPXW"`).
2. `markFlowFrameDeliveredForTicker(ticker, now)` — always writes the existing market-wide
   heartbeat (every other consumer of `isFlowFrameFreshAnywhere`/`isFlowFrameFreshFromCluster` —
   cluster health, the flow-ingest REST-skip decision, admin dashboards — is unaffected), and
   ADDITIONALLY writes a second, narrower `flow_alerts:last_delivered_at:spx_cohort` heartbeat key
   only when `ticker` is SPX/SPXW. `flow-persist.ts`'s write site now calls this instead of the
   unscoped `markFlowFrameDelivered()`.
3. `isFlowFreshForSpxCohort(maxAgeMs)` — the scoped read, mirroring
   `isFlowFrameFreshAnywhere`'s own shape/fail-open contract (Redis down / no heartbeat / error →
   `false`, so the caller falls back to the real tape-grounded age — never worse than before).
4. `spx-desk.ts`'s both `flowClusterLive` computations now call `isFlowFreshForSpxCohort(120_000)`
   instead of `isFlowFrameFreshAnywhere(120_000)`. `deskFlowDataAgeMs`'s own clamp logic is
   UNCHANGED — only the boolean fed into it is now correctly scoped.

### Fix rationale — why a scoped signal, not dropping the override

The task brief named two reasonable approaches: add a ticker/cohort-scoped freshness check, or
(if that isn't cheaply derivable) drop the clamp/override entirely and rely on the already-honest
tape-grounded `resolveFlowDataAgeMs`. A scoped signal was feasible and cheap here — the existing
heartbeat architecture (`flow-liveness.ts`) already has exactly the write-throttle / Redis-with-
in-memory-fallback / fail-open shape this needs; adding a second, narrowly-scoped key alongside
the existing one reuses that shape rather than inventing new surface area. This preserves the
clamp's genuine original intent (excusing real replica-side staleness jitter when SPX's own tape
IS corroborated live) while closing the exact gap the bug report identified (a signal that
couldn't tell SPX's tape apart from the rest of the market). Dropping the override outright was
the more conservative fallback named in the brief, but was not needed once the scoped signal
proved cheap to add from the existing architecture — and would have removed a real, intentional
affordance (tolerating replica lag) rather than fixing its scope.

What was deliberately left unchanged:
- `isFlowFrameFreshAnywhere`/`isFlowFrameFreshFromCluster` and every OTHER consumer of them
  (`admin-spx-health.ts`, `admin-spx-issues.ts`, `admin-helix-health.ts`, `ecosystem-context.ts`,
  `spx-signal-log.ts`, `spx-signals-shadow.ts`, `cron-writer-target-fresh.ts`,
  `flow-ingest.ts`) — these are legitimately market-wide observability/REST-skip signals, not
  SPX-tape-staleness gates, and are out of this fix's scope.
- `deskFlowDataAgeMs`'s clamp logic itself (`if (flowClusterLive && age > 120_000) age =
  120_000;`) — unchanged; only its caller-supplied argument is now correctly scoped.
- `resolveFlowDataAgeMs`/`flow-data-freshness.ts` — untouched; a separate, pre-existing
  replica-local freshness heuristic not named in the bug report, out of this fix's scoped files.

### Regression tests (RED → GREEN proof)

Three test files, each verified to fail before the fix and pass after (git-stash proof, see
Verification below):

1. `src/lib/flow-liveness.test.ts` (extended) — drives the real `markFlowFrameDeliveredForTicker`/
   `isFlowFreshForSpxCohort`/`isFlowFrameFreshAnywhere` (no mocks; Redis is unconfigured in this
   sandbox so `sharedCacheGet`/`sharedCacheSet` run their real in-memory fallback): an unrelated
   ticker's (`AAPL`) fresh print reads market-wide live but NOT SPX-cohort live; an `SPXW` print
   makes the SPX-cohort signal live too.
2. `src/features/spx/lib/spx-play-gates.test.ts` (extended) — exercises `evaluatePlayGates` end to
   end with the REAL liveness signal: an `AAPL` print is market-wide live while SPX's own flow age
   is genuinely 310s old; feeding the SPX-cohort-scoped signal correctly lets the stale-flow
   BUY-block fire, while feeding the OLD market-wide signal into the identical scenario would have
   (wrongly) suppressed it — demonstrating the exact bug. A third test covers the softer
   warning-tier (120s–300s) case.
3. `src/features/spx/lib/spx-desk-flow-staleness.test.ts` (new) — exercises `deskFlowDataAgeMs`
   ITSELF (exported for testability, mirroring the established `spx-desk-wall-scope.test.ts`/
   `spx-desk-data-quality.test.ts` pattern of mocking `server-only` then dynamically importing
   `./spx-desk` as a value): a genuinely-stale (400s) SPX tape is NOT clamped fresh when only an
   unrelated ticker corroborates the market-wide signal; the clamp still correctly fires to 120s
   when SPX's OWN cohort is genuinely corroborated live — proving the clamp's original intent
   survives the fix.

### Verification

- `npx tsx --experimental-test-module-mocks --test src/lib/flow-liveness.test.ts
  src/features/spx/lib/spx-play-gates.test.ts src/features/spx/lib/spx-desk-flow-staleness.test.ts`
  — RED pre-fix (`git stash` the 4 fix files only, keep test files in place: 3 new
  `flow-liveness.test.ts` tests fail, 3 new `spx-play-gates.test.ts` tests fail, both new
  `spx-desk-flow-staleness.test.ts` tests fail — all with `markFlowFrameDeliveredForTicker is not
  a function`, every pre-existing test in each file still passes), GREEN post-fix (38/38 pass,
  restored via `git stash apply` + drop).
- Full suite (`npm test`, Node 20) — pass, 0 fail.
- `npx tsc --noEmit` (Node 20) — clean, exit 0.
