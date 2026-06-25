// Pure, alias-free: does a uwGet error message denote a TRANSIENT network/connect
// failure (a momentary api.unusualwhales.com / DNS / socket blip) rather than an HTTP
// status error (4xx/5xx, handled by status-specific branches)? These are the undici/Node
// connect-level signatures of the RT-2 class (see docs/audit/00-RUNTIME-FINDINGS.md):
// `fetch failed`, connect timeout, host/net unreachable, connection reset/refused, a DNS
// hiccup, or a dropped socket. Kept in its own module so it is unit-testable under
// `npx tsx --test` without loading the heavy unusual-whales provider module.
const TRANSIENT_NETWORK =
  /\b(?:fetch failed|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET|ConnectTimeoutError|Connect Timeout Error|EHOSTUNREACH|ENETUNREACH|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|EAI_AGAIN|ENOTFOUND|socket hang up)\b/i;

export function isUwTransientNetwork(msg: string): boolean {
  return TRANSIENT_NETWORK.test(msg);
}
