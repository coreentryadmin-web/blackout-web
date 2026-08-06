/**
 * NH-R3 — Polygon/Massive REST upstream health tracking (evidence-only, no gating).
 *
 * WS-21 (`src/lib/ws/source-health.ts`) modeled the UW multiplex WebSocket's recovery lifecycle and
 * ships a commit gate that is default-OFF. That module covers exactly one source (UW WS); Polygon/
 * Massive REST — the other upstream the whole 0DTE pipeline depends on for bars/chains/snapshots/VIX —
 * had NO health tracking at all: `polygon-rate-limiter.ts` already observes every call's success/429
 * outcome (`notePolygonOk`/`notePolygon429`, used to drive the reactive circuit breaker) but never
 * turned that into an inspectable liveness signal.
 *
 * This is a CLEARLY-PARALLEL SIBLING, not an extension of source-health.ts, because the two upstreams
 * have genuinely different shapes: the WS lifecycle needs OFFLINE→RECOVERING→CATCHING_UP→WARM→HEALTHY
 * because a dropped socket has a reconciliation GAP to backfill before frames can be trusted again.
 * Polygon REST has no such gap — each call is independent and already carries its own success/failure,
 * so the parallel state machine here is simpler (no "backfill window" concept) while reusing the same
 * DESIGN PATTERN: an ordered state list, a pure reducer over recorded events, and a snapshot() read.
 *
 * ADDITIVE / EVIDENCE-ONLY: nothing reads this to withhold a commit. It exists so admin/telemetry can
 * see "is the Polygon REST upstream actually healthy right now" the same way WS-21 exposes UW health —
 * without touching `requireHealthySourceEnabled`'s existing default-OFF UW gate at all. If a Polygon
 * commit gate is ever wanted, it should mirror `commitAuthorizedBySourceHealth`'s explicit-opt-in shape,
 * not be silently inferred from this module's presence.
 *
 * Pure + alias-free so it is unit-testable under `tsx --test` without a live Polygon client.
 */

export type PolygonUpstreamHealthState = "UNKNOWN" | "DOWN" | "DEGRADED" | "HEALTHY";

/** Ordered, low→high, mirrors SOURCE_HEALTH_ORDER's "callers can compare recency/severity" shape. */
export const POLYGON_UPSTREAM_HEALTH_ORDER: readonly PolygonUpstreamHealthState[] = [
  "DOWN",
  "DEGRADED",
  "UNKNOWN",
  "HEALTHY",
] as const;

/** Consecutive failures before DEGRADED (a real signal, not one flaky call). */
const DEGRADED_THRESHOLD = 2;
/** Consecutive failures before DOWN (matches the rate-limiter's own breaker threshold order of magnitude). */
const DOWN_THRESHOLD = 5;
/** Consecutive successes required to climb back out of DEGRADED to HEALTHY after a failure streak. */
const RECOVERY_THRESHOLD = 3;

export type PolygonUpstreamHealthSnapshot = {
  state: PolygonUpstreamHealthState;
  /** ms when the current state was entered. */
  since: number;
  consecutive_failures: number;
  consecutive_successes: number;
  last_success_at: number | null;
  last_failure_at: number | null;
  /** Total calls recorded since process start (diagnostic only). */
  total_calls: number;
  total_failures: number;
};

export interface PolygonUpstreamHealth {
  /** A call succeeded (any non-429, non-5xx, non-network-error response). */
  recordSuccess(now?: number): void;
  /** A call failed (429, 5xx, or a thrown network error). */
  recordFailure(now?: number): void;
  snapshot(): PolygonUpstreamHealthSnapshot;
}

export function makePolygonUpstreamHealth(): PolygonUpstreamHealth {
  let state: PolygonUpstreamHealthState = "UNKNOWN";
  let since = Date.now();
  let consecutiveFailures = 0;
  let consecutiveSuccesses = 0;
  let lastSuccessAt: number | null = null;
  let lastFailureAt: number | null = null;
  let totalCalls = 0;
  let totalFailures = 0;

  function enter(next: PolygonUpstreamHealthState, now: number): void {
    if (state === next) return;
    state = next;
    since = now;
  }

  return {
    recordSuccess(now = Date.now()): void {
      totalCalls += 1;
      consecutiveFailures = 0;
      consecutiveSuccesses += 1;
      lastSuccessAt = now;
      // A single success out of DOWN/UNKNOWN is promising but not proof — require a short streak
      // (RECOVERY_THRESHOLD) before declaring HEALTHY, same "don't trust one frame" instinct as
      // WS-21's warm-up window, sized for REST calls instead of socket frames.
      if (consecutiveSuccesses >= RECOVERY_THRESHOLD) {
        enter("HEALTHY", now);
      } else if (state === "DOWN") {
        enter("DEGRADED", now);
      }
    },
    recordFailure(now = Date.now()): void {
      totalCalls += 1;
      totalFailures += 1;
      consecutiveSuccesses = 0;
      consecutiveFailures += 1;
      lastFailureAt = now;
      if (consecutiveFailures >= DOWN_THRESHOLD) {
        enter("DOWN", now);
      } else if (consecutiveFailures >= DEGRADED_THRESHOLD) {
        enter("DEGRADED", now);
      }
    },
    snapshot(): PolygonUpstreamHealthSnapshot {
      return {
        state,
        since,
        consecutive_failures: consecutiveFailures,
        consecutive_successes: consecutiveSuccesses,
        last_success_at: lastSuccessAt,
        last_failure_at: lastFailureAt,
        total_calls: totalCalls,
        total_failures: totalFailures,
      };
    },
  };
}

/** Process-wide singleton — one Polygon REST upstream, mirrored by the one shared rate-limiter/breaker. */
let sharedHealth: PolygonUpstreamHealth | null = null;

export function polygonUpstreamHealth(): PolygonUpstreamHealth {
  if (!sharedHealth) sharedHealth = makePolygonUpstreamHealth();
  return sharedHealth;
}

/** Test-only: reset the process-wide singleton between cases (module state persists across a test file). */
export function resetPolygonUpstreamHealthForTest(): void {
  sharedHealth = makePolygonUpstreamHealth();
}
