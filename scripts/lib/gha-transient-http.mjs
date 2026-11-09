/** ALB drain / rolling ECS deploy statuses — retry before failing deploy smoke. */
const TRANSIENT_HTTP = new Set([502, 503, 504, 524]);

export function isTransientHttpStatus(status) {
  return TRANSIENT_HTTP.has(status);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{ attempts?: number, delayMs?: number, shouldRetry?: (result: T) => boolean, onRetry?: (attempt: number, result: T) => void }} opts
 */
export async function withTransientRetry(fn, opts = {}) {
  const attempts = opts.attempts ?? 6;
  const delayMs = opts.delayMs ?? 5_000;
  const shouldRetry = opts.shouldRetry ?? (() => false);

  let last;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    last = await fn();
    if (!shouldRetry(last) || attempt === attempts) return last;
    opts.onRetry?.(attempt + 1, last);
    await sleep(delayMs);
  }
  return last;
}
