/** Hard ceiling for one `scanZeroDteBoard()` invocation on the zerodte-warm cron path.
 *  A hung scan must not block `recordZeroDteScanTick` past the 10m `critical_stale`
 *  watchdog band (see play-engine-heartbeat.ts). Default 8m leaves ~2m headroom before
 *  cron-audit query fails. Override in tests via `ZERODTE_SCAN_WARM_TIMEOUT_MS`. */
export function zerodteScanWarmTimeoutMs(): number {
  const n = Number(process.env.ZERODTE_SCAN_WARM_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 8 * 60_000;
}

export type WarmDeadlineResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "timeout" }
  | { ok: false; reason: "error"; error: unknown };

/** Race `work` against a fixed deadline. On timeout the underlying promise is detached
 *  (errors swallowed) so a long-running scan cannot surface as an unhandled rejection. */
export async function awaitWithWarmDeadline<T>(
  work: Promise<T>,
  timeoutMs: number
): Promise<WarmDeadlineResult<T>> {
  const settled = work.then(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, reason: "error" as const, error })
  );
  const timeout = new Promise<{ ok: false; reason: "timeout" }>((resolve) => {
    setTimeout(() => resolve({ ok: false, reason: "timeout" }), timeoutMs);
  });
  const first = await Promise.race([settled, timeout]);
  if (!first.ok && first.reason === "timeout") {
    void work.catch(() => {});
  }
  return first;
}
