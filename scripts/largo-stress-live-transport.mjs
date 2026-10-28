/**
 * Live Largo stress transport layer — retries 429 + transient fetch failures without
 * aborting the whole sweep (a bare throw mid-run is indistinguishable from a code bug in CI).
 */
import { isRetryableFetchError } from "./audit/lib/fetch-retry.mjs";

/**
 * @param {() => Promise<{ status: number, answer?: string, ms?: number, [k: string]: unknown }>} askOnce
 * @param {{ attempts?: number, backoffMs?: (attemptIndex: number) => number }} [opts]
 */
export async function withLiveTransportRetries(askOnce, opts = {}) {
  const attempts = opts.attempts ?? 4;
  const backoffMs = opts.backoffMs ?? ((i) => 2000 * (i + 1));
  let last = null;

  for (let i = 0; i < attempts; i++) {
    try {
      last = await askOnce();
    } catch (err) {
      if (i < attempts - 1 && isRetryableFetchError(err)) {
        await new Promise((r) => setTimeout(r, backoffMs(i)));
        continue;
      }
      return {
        status: 503,
        answer: "",
        ms: 0,
        transport_failed: true,
        transport_error: err?.cause?.code ?? err?.message ?? String(err),
      };
    }

    if (last.status !== 429) return last;
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, backoffMs(i)));
    }
  }

  return last ? { ...last, throttled: true } : { status: 429, answer: "", ms: 0, throttled: true };
}
