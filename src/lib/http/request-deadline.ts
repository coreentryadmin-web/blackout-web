/**
 * REQUEST-LEVEL DEADLINES
 * =======================
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * `next.config.mjs` sets `output: "standalone"` (line 80) so this app ships as a
 * plain Node server on ECS/Fargate. `export const maxDuration = N` is a
 * **Vercel-platform** construct: on Vercel it configures the serverless function
 * timeout, and on any other host it is an exported number that nothing reads.
 * There are 53 such declarations across `src/app/api/**\/route.ts` and every one
 * of them is inert here.
 *
 * The consequence is that **nothing in this process caps a request handler**. The
 * ALB's `idle_timeout = 120` (blackout-infra `terraform/modules/alb/main.tf`) is
 * the only bound in the entire stack, and the way it expresses itself is a 504
 * with no body, no server-side log line, and no cancellation of the work that is
 * still running behind it.
 *
 * Measured on the production ALB (CloudWatch, 2026-07-28..08-06):
 *   - HTTPCode_ELB_504_Count: 7,556 - 10,937 per DAY, every day
 *   - TargetResponseTime Maximum: pinned at 119.6 - 119.99s, hour after hour
 *   - TargetResponseTime p99: 19 - 42s during RTH
 * A Maximum that sits at the idle timeout is the signature of requests being cut
 * off by the load balancer rather than completing.
 *
 * IMPLEMENT RATHER THAN DELETE -- WHY
 * -----------------------------------
 * The alternative to this module is deleting all 53 declarations and documenting
 * that the ALB is the only bound. That was rejected because the declarations are
 * not the problem; the missing enforcement is. Enforcing buys three things that
 * deleting cannot:
 *
 *   1. A **diagnostic 504 instead of an opaque one.** The ALB's 504 is generated
 *      after the connection is severed, so the app never learns it happened. A
 *      deadline that fires *before* the ALB lets the app answer with a real body
 *      and, more importantly, emit a structured log line naming the route and the
 *      elapsed time.
 *   2. **Route attribution that works today.** ALB access logs are being enabled
 *      in blackout-infra to rank offending routes, but they are a separate system
 *      with a delivery lag. The log line this module emits is immediate.
 *   3. **Actual cancellation.** The deadline aborts an `AbortSignal` the handler
 *      can thread into its upstream calls, so the work stops instead of running
 *      on unobserved and holding a connection, a DB handle and a rate-limiter slot
 *      after the client is gone.
 *
 * This is also not a new pattern for this codebase -- it is a generalization of
 * one a route already hand-rolled. `src/app/api/cron/nighthawk-edition/route.ts`
 * declares `maxDuration = 800` with a comment explaining that an internal budget
 * guard checkpoints before the host can kill it, precisely because the author
 * understood the declaration alone would not save them. (That particular guard is
 * a separate matter -- see the PR write-up.)
 *
 * DO NOT WRAP STREAMING ROUTES
 * ----------------------------
 * `idle_timeout` is an **idle** timer: any byte written to the socket resets it.
 * SSE endpoints in this app heartbeat well inside 120s
 * (`/api/market/gex-matrix-deltas` at 15s, `/api/market/largo/query` at 12s), so
 * they never trip the ALB and are NOT part of the 504 population. Wrapping them
 * in a wall-clock deadline would actively break a working long-lived stream --
 * their `maxDuration` is a stream lifetime, not a work budget. `withRequestDeadline`
 * is for handlers that compute and then answer once.
 */

/**
 * ALB `idle_timeout.timeout_seconds` for `blackout-production-alb`, in ms.
 * Verified live via `aws elbv2 describe-load-balancer-attributes` and declared in
 * blackout-infra `terraform/modules/alb/main.tf`. Keep the two in sync -- if the
 * ALB timeout is ever changed, this constant must move with it or the in-process
 * deadline stops being the tighter of the two and becomes decorative.
 */
export const ALB_IDLE_TIMEOUT_MS = 120_000;

/**
 * How far ahead of the ALB the in-process deadline must fire.
 *
 * The entire value of this module comes from *winning the race* against the load
 * balancer: if the ALB cuts the connection first, the client gets the same opaque
 * 504 as before and the diagnostic log line never gets written. The headroom has
 * to cover response serialization plus scheduler jitter on a saturated event loop
 * -- and a saturated event loop is exactly the condition under which the deadline
 * fires, so the jitter is not hypothetical.
 *
 * 5s is roughly 100x the normal macrotask delay and still leaves a handler
 * declaring the ALB's own 120s an effective 115s, which is not a meaningful
 * reduction in capability for any real workload.
 */
export const DEADLINE_HEADROOM_MS = 5_000;

/** The largest deadline that can still beat the ALB. */
export const MAX_EFFECTIVE_DEADLINE_MS = ALB_IDLE_TIMEOUT_MS - DEADLINE_HEADROOM_MS;

/**
 * Floor for an effective deadline. Guards against a typo'd or programmatically
 * derived `maxDuration` of 0 or a negative number silently producing a handler
 * that times out before it starts.
 */
export const MIN_EFFECTIVE_DEADLINE_MS = 1_000;

export type DeadlineResolution = {
  /** The deadline that will actually be enforced, in ms. */
  effectiveMs: number;
  /** What the route declared, in ms. `null` when the route declared nothing. */
  declaredMs: number | null;
  /**
   * True when the declared value could never have been honoured because the ALB
   * would have severed the connection first. These are the declarations that are
   * actively misleading: they read as protection at a duration the stack cannot
   * deliver.
   */
  clamped: boolean;
  /** Machine-readable reason, for logs and tests. */
  reason: "declared" | "clamped_to_alb" | "raised_to_floor" | "defaulted";
};

/**
 * Turn a route's declared `maxDuration` (in SECONDS, matching the Next.js export)
 * into the deadline this process will actually enforce (in MILLISECONDS).
 *
 * Pure and total -- no clock, no I/O -- so the clamping policy is unit-testable
 * without running a server.
 */
export function resolveRequestDeadlineMs(declaredSeconds?: number | null): DeadlineResolution {
  if (
    declaredSeconds === undefined ||
    declaredSeconds === null ||
    !Number.isFinite(declaredSeconds)
  ) {
    return {
      effectiveMs: MAX_EFFECTIVE_DEADLINE_MS,
      declaredMs: null,
      clamped: false,
      reason: "defaulted",
    };
  }

  const declaredMs = Math.round(declaredSeconds * 1000);

  if (declaredMs > MAX_EFFECTIVE_DEADLINE_MS) {
    return {
      effectiveMs: MAX_EFFECTIVE_DEADLINE_MS,
      declaredMs,
      clamped: true,
      reason: "clamped_to_alb",
    };
  }

  if (declaredMs < MIN_EFFECTIVE_DEADLINE_MS) {
    return {
      effectiveMs: MIN_EFFECTIVE_DEADLINE_MS,
      declaredMs,
      clamped: false,
      reason: "raised_to_floor",
    };
  }

  return { effectiveMs: declaredMs, declaredMs, clamped: false, reason: "declared" };
}

/**
 * True when a route's declared `maxDuration` exceeds what the stack can deliver.
 *
 * As of this commit 11 of the 53 declarations are in this state (3 at 180s, 6 at
 * 300s, 2 at 800s) -- all of them cron or admin routes, none member-facing. They
 * are unachievable twice over, because cron routes are additionally bounded by the
 * cron Lambda's own client budget (60s default, 90s for the `x-*` paths -- see
 * blackout-infra `terraform/modules/crons/lambda/index.js`), which is tighter than
 * the ALB.
 */
export function isOverDeclared(declaredSeconds?: number | null): boolean {
  return resolveRequestDeadlineMs(declaredSeconds).clamped;
}

export type RequestDeadlineContext = {
  /**
   * Aborts when the deadline expires. Thread this into `fetch`, provider helpers
   * and DB calls so the work actually stops -- without it the handler is merely
   * *reported* as timed out while continuing to consume a connection, a rate-limiter
   * slot and event-loop time on behalf of a client that is already gone.
   */
  signal: AbortSignal;
  /** Epoch ms at which the deadline fires. */
  deadlineAt: number;
  /** Remaining budget in ms, floored at 0. Useful for sizing per-call timeouts. */
  remainingMs: () => number;
};

export type RequestDeadlineOptions = {
  /**
   * Stable identifier for the route, e.g. `"GET /api/market/foo"`. This is the
   * attribution key in the log line, so it must not embed per-request values
   * (ids, tickers) or the logs cannot be aggregated.
   */
  route: string;
  /**
   * The route's `maxDuration`, in seconds -- pass the same constant the file
   * exports so there is exactly one number to read. Omit to default to the
   * maximum that still beats the ALB.
   */
  maxDurationSeconds?: number | null;
  /** Injectable for tests. */
  now?: () => number;
  /** Injectable for tests. */
  onTimeout?: (info: DeadlineTimeoutInfo) => void;
};

export type DeadlineTimeoutInfo = {
  route: string;
  elapsedMs: number;
  effectiveMs: number;
  declaredMs: number | null;
  clamped: boolean;
};

/** Body returned to the client when the in-process deadline wins the race. */
export function deadlineExceededBody(info: DeadlineTimeoutInfo): Record<string, unknown> {
  return {
    error: "deadline_exceeded",
    message: `Request exceeded its ${Math.round(info.effectiveMs / 1000)}s server deadline.`,
    route: info.route,
    elapsed_ms: info.elapsedMs,
    deadline_ms: info.effectiveMs,
    // Surfaced so a reader of the response can immediately see when a route's
    // declared budget was never achievable, without cross-referencing the source.
    declared_ms: info.declaredMs,
    declared_unachievable: info.clamped,
  };
}

/**
 * Structured, greppable log line. Deliberately a single line of JSON so it can be
 * pulled straight out of CloudWatch Logs Insights and grouped by `route` --
 * this is the route attribution that exists the moment this deploys, ahead of ALB
 * access logs being delivered.
 */
export function logDeadlineExceeded(info: DeadlineTimeoutInfo): void {
  console.error(
    `[request-deadline] ${JSON.stringify({ event: "deadline_exceeded", ...info })}`
  );
}

/**
 * Wrap a Next.js route handler so it is bounded by a real, in-process deadline.
 *
 * On expiry the handler's promise is abandoned, the context signal is aborted, a
 * structured line is logged and a 504 with a diagnostic body is returned -- all
 * strictly before the ALB would have severed the connection.
 *
 * The deadline context is passed as the FINAL argument so the wrapper composes
 * with Next's own handler signature (`(req)` and `(req, { params })`) without
 * disturbing it.
 *
 * NOT for streaming/SSE routes -- see the module header.
 */
export function withRequestDeadline<Args extends unknown[]>(
  options: RequestDeadlineOptions,
  handler: (req: Request, ...args: [...Args, RequestDeadlineContext]) => Promise<Response>
): (req: Request, ...args: Args) => Promise<Response> {
  const resolution = resolveRequestDeadlineMs(options.maxDurationSeconds);
  const now = options.now ?? Date.now;
  const onTimeout = options.onTimeout ?? logDeadlineExceeded;

  return async (req: Request, ...args: Args): Promise<Response> => {
    const startedAt = now();
    const controller = new AbortController();
    const deadlineAt = startedAt + resolution.effectiveMs;

    const ctx: RequestDeadlineContext = {
      signal: controller.signal,
      deadlineAt,
      remainingMs: () => Math.max(0, deadlineAt - now()),
    };

    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeout = new Promise<Response>((resolve) => {
      timer = setTimeout(() => {
        const info: DeadlineTimeoutInfo = {
          route: options.route,
          elapsedMs: now() - startedAt,
          effectiveMs: resolution.effectiveMs,
          declaredMs: resolution.declaredMs,
          clamped: resolution.clamped,
        };
        // Abort BEFORE responding so in-flight upstream work is cancelled even
        // though we are no longer waiting on it.
        controller.abort(new Error(`Request deadline exceeded: ${options.route}`));
        onTimeout(info);
        resolve(
          new Response(JSON.stringify(deadlineExceededBody(info)), {
            status: 504,
            headers: {
              "content-type": "application/json",
              "cache-control": "no-store",
            },
          })
        );
      }, resolution.effectiveMs);
      // Never hold the process open for a deadline timer.
      timer?.unref?.();
    });

    try {
      return await Promise.race([
        handler(req, ...([...args, ctx] as [...Args, RequestDeadlineContext])),
        timeout,
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}
