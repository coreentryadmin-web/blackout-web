/**
 * RATE-LIMITER QUEUE BUDGET
 * =========================
 *
 * WHY THIS EXISTS -- THE MECHANISM BEHIND THE SLOW TAIL
 * -----------------------------------------------------
 * It is tempting to assume the production 504s come from missing socket timeouts
 * on upstream calls. They do not: `trackedFetch` (`src/lib/api-tracked-fetch.ts`)
 * has always applied `AbortSignal.timeout(timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS)`
 * with a 15s default, and both provider funnels go through it.
 *
 * The unbounded wait is *before* the fetch. Both cluster limiters admit a call by
 * spinning until a slot frees, with no overall budget:
 *
 *   src/lib/providers/uw-rate-limiter.ts
 *     acquireSlot()      -> `for (;;)` retrying the Redis rps/concurrency slot every 40ms
 *     acquireLocalSlot() -> `for (;;)` retrying the local token bucket
 *     waitForCircuit()   -> sleeps until the breaker's `circuitOpenUntil`
 *
 *   src/lib/providers/polygon-rate-limiter.ts
 *     acquirePolygonSlot() / acquireLocalSlot() / waitForCircuit() -- same shape
 *
 * `AbortSignal.timeout` only starts counting once `fetch()` is called, so a request
 * parked in one of those loops is invisible to it. Under saturation a handler can
 * sit in the queue indefinitely, and because the handler has no deadline of its own
 * (see `src/lib/http/request-deadline.ts`), the ALB's 120s `idle_timeout` is what
 * finally ends it -- as a 504.
 *
 * That also explains the shape of the CloudWatch data: p99 TargetResponseTime of
 * 19-42s during RTH (queueing, not a single slow upstream) with Maximum pinned at
 * 119.6-119.99s (the ALB ceiling), on 7.5k-11k 504s/day.
 *
 * WHY THIS FIX DOES NOT NEED ROUTE ATTRIBUTION
 * --------------------------------------------
 * Route-level attribution for the 504 volume is still pending ALB access logs, so
 * per-route deadline tuning would be guesswork today. Bounding the queue does not
 * have that dependency: every slow provider-backed route passes through these two
 * chokepoints, so capping the wait here bounds the tail regardless of which route
 * the logs eventually rank first. It is the one part of this fix that is
 * evidence-complete right now.
 */

/**
 * Default ceiling on how long a caller may wait to be ADMITTED by a rate limiter,
 * before the upstream request is even attempted.
 *
 * Choosing this number:
 *   - On the uncontended path the wait is 0ms -- the token bucket refills
 *     synchronously and no sleep happens at all. So this budget is never paid by a
 *     healthy request; it only truncates a pathological one.
 *   - The cluster ceiling is 150 rps (POLYGON_GLOBAL_MAX_RPS / the UW equivalent).
 *     A 20s wait therefore means roughly 3,000 calls are queued ahead of you.
 *     Past that point the data a member is waiting for will be stale by the time it
 *     arrives, and the SWR poll that asked for it has already fired again.
 *   - It must sit well under the ALB's 120s so the failure is a fast, logged,
 *     handled error rather than an opaque load-balancer 504, and well above any
 *     legitimate burst so normal traffic never sees it.
 *
 * 20s satisfies all three with a wide margin on each side. Tunable per provider via
 * env without a code change.
 */
export const DEFAULT_QUEUE_MAX_WAIT_MS = 20_000;

/** Thrown when a caller waits longer than the queue budget to be admitted. */
export class RateLimiterQueueTimeoutError extends Error {
  readonly provider: string;
  readonly waitedMs: number;
  readonly budgetMs: number;
  /** Where in the admission sequence the budget ran out -- for triage. */
  readonly stage: QueueStage;

  constructor(provider: string, stage: QueueStage, waitedMs: number, budgetMs: number) {
    super(
      `[${provider}] rate-limiter queue budget exceeded at ${stage}: waited ${waitedMs}ms of ${budgetMs}ms`
    );
    this.name = "RateLimiterQueueTimeoutError";
    this.provider = provider;
    this.stage = stage;
    this.waitedMs = waitedMs;
    this.budgetMs = budgetMs;
  }
}

export type QueueStage = "circuit" | "global_rps" | "global_concurrency" | "local_slot";

/**
 * Read a provider's queue budget from env, falling back to the shared default.
 *
 * Pure apart from the caller-supplied env bag so the parsing rules are testable.
 * A non-numeric, zero or negative value falls back rather than disabling the bound
 * -- an unbounded queue is the bug this module exists to remove, so it must not be
 * reachable by fat-fingering an env var.
 */
export function resolveQueueBudgetMs(
  envValue: string | undefined,
  fallbackMs: number = DEFAULT_QUEUE_MAX_WAIT_MS
): number {
  if (envValue === undefined) return fallbackMs;
  const trimmed = envValue.trim();
  if (trimmed === "") return fallbackMs;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackMs;
  return Math.floor(parsed);
}

/**
 * A single admission attempt's budget tracker. Created once per `acquireSlot()` call
 * so the budget spans the WHOLE admission sequence (breaker wait + global rps spin +
 * global concurrency spin + local bucket spin) rather than resetting per stage --
 * resetting per stage would let a caller starve for an unbounded total while each
 * individual stage stayed "within budget".
 */
export class QueueBudget {
  readonly provider: string;
  readonly budgetMs: number;
  private readonly startedAt: number;
  private readonly now: () => number;

  constructor(provider: string, budgetMs: number, now: () => number = Date.now) {
    this.provider = provider;
    this.budgetMs = budgetMs;
    this.now = now;
    this.startedAt = now();
  }

  waitedMs(): number {
    return this.now() - this.startedAt;
  }

  remainingMs(): number {
    return Math.max(0, this.budgetMs - this.waitedMs());
  }

  expired(): boolean {
    return this.waitedMs() >= this.budgetMs;
  }

  /** Throw if the budget is spent. Call at the top of every spin iteration. */
  assertWithinBudget(stage: QueueStage): void {
    if (this.expired()) {
      throw new RateLimiterQueueTimeoutError(this.provider, stage, this.waitedMs(), this.budgetMs);
    }
  }

  /**
   * Clamp a planned sleep so a spin loop cannot overshoot the budget by a whole
   * sleep interval, and always yields at least 1ms so the loop stays async.
   */
  clampSleepMs(desiredMs: number): number {
    return Math.max(1, Math.min(desiredMs, this.remainingMs()));
  }
}

/** True when an unknown error is a queue-budget timeout. */
export function isQueueTimeout(err: unknown): err is RateLimiterQueueTimeoutError {
  return err instanceof RateLimiterQueueTimeoutError;
}
