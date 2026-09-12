/**
 * Retry a single statement execution on a Postgres deadlock (`40P01 deadlock_detected`).
 *
 * Root cause this was written for (2026-09-12): `db-cleanup`'s nightly batched-DELETE loop
 * deadlocked against a concurrent second invocation of ITSELF (see db-cleanup/route.ts's overlap
 * guard, added the same investigation) -- but even with that guard closing the concurrent-run
 * hole, a genuinely concurrent WRITER on the same table (e.g. the Vector bead recorder inserting
 * into `vector_wall_history` mid-prune) can still deadlock a batched DELETE by ordinary lock
 * contention. Postgres's own deadlock detector picks a victim, rolls its statement back, and
 * reports `40P01` -- the standard, safe response to that specific code is exactly what Postgres
 * tells the losing side to do: run the same statement again. This is NOT a generic "retry on any
 * DB error" helper -- only 40P01 is retried; every other error (including 42P01
 * undefined_table, handled separately by db-cleanup's own allow-list-driven skip) is rethrown on
 * the first attempt.
 *
 * Bounded + jittered-by-attempt so a genuinely wedged table still gives up rather than retrying
 * forever and burning the cron's `maxDuration` budget. Pure/injectable (`run`/`sleep` are passed
 * in) so the retry-vs-give-up boundary is unit-testable without a real Postgres connection --
 * see deadlock-retry.test.ts.
 */

export const POSTGRES_DEADLOCK_DETECTED = "40P01";

export type DeadlockRetryOptions = {
  /** Max retries AFTER the first attempt. Default 3 (i.e. up to 4 total attempts). */
  maxRetries?: number;
  /** Base backoff in ms; actual delay is `baseDelayMs * attemptNumber` (attempt 1, 2, 3, ...). */
  baseDelayMs?: number;
  /** Injectable so tests don't have to wait out a real delay. */
  sleep?: (ms: number) => Promise<void>;
  /** Called once per retry (attempt is 1-indexed: "this is retry #1"), for logging. */
  onRetry?: (attempt: number, err: unknown) => void;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Structural check: pg's client attaches a `.code` string to the thrown error object. */
function isDeadlockError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === POSTGRES_DEADLOCK_DETECTED
  );
}

export async function runWithDeadlockRetry<T>(
  run: () => Promise<T>,
  opts: DeadlockRetryOptions = {}
): Promise<T> {
  const maxRetries = opts.maxRetries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 100;
  const sleep = opts.sleep ?? defaultSleep;

  // attempt 0 = the original try; attempts 1..maxRetries are retries.
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (err) {
      if (!isDeadlockError(err) || attempt >= maxRetries) {
        throw err;
      }
      opts.onRetry?.(attempt + 1, err);
      await sleep(baseDelayMs * (attempt + 1));
      // loop and retry
    }
  }
}
