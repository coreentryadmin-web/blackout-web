/**
 * Per-process circuit breaker for HARD Anthropic account failures (billing/auth).
 *
 * Why this exists (2026-07-10 incident): when the Anthropic account ran out of
 * credits, EVERY call started failing with a 400 "credit balance is too low".
 * Nothing negative-caches on that path, so every member dashboard retried the
 * commentary route, and every retry made a fresh Anthropic attempt (× SDK
 * internal retries) — a platform-wide call storm against an account that is
 * GUARANTEED to keep failing until a human fixes billing.
 *
 * Billing/auth failures are categorically different from transient 429/5xx/
 * network errors (which the SDK's own retry budget handles): no amount of
 * retrying fixes them. So on the first such failure we open this breaker and
 * every AI surface (commentary, Largo, Night Hawk, GEX explain, …) skips
 * Anthropic entirely for the cooldown, then probes again with ONE call.
 *
 * Kept per-process (same precedent as the SpendTracker fallback in
 * anthropic.ts): each replica trips after at most one failed call, which is
 * bounded and avoids a Redis dependency in the hot path.
 */

export const ANTHROPIC_BREAKER_COOLDOWN_MS = 10 * 60 * 1000;

let openUntilMs = 0;
let openReason = "";

/**
 * True only for failures that indicate the ACCOUNT is unusable (not the
 * request): invalid/revoked key (401/403) or the billing 400 Anthropic returns
 * when the credit balance is exhausted. Plain 400s (bad params) stay
 * retryable-by-fix and must NOT trip the breaker.
 */
export function isHardAnthropicAccountFailure(
  status: number | null | undefined,
  message: string
): boolean {
  if (status === 401 || status === 403) return true;
  return status === 400 && /credit balance/i.test(message);
}

export function tripAnthropicBreaker(reason: string, nowMs: number = Date.now()): void {
  openUntilMs = nowMs + ANTHROPIC_BREAKER_COOLDOWN_MS;
  openReason = reason.slice(0, 300);
}

/** Epoch ms the breaker stays open until, or null when closed (calls allowed). */
export function anthropicBreakerOpenUntil(nowMs: number = Date.now()): number | null {
  return nowMs < openUntilMs ? openUntilMs : null;
}

export function anthropicBreakerReason(): string {
  return openReason;
}

export function resetAnthropicBreakerForTests(): void {
  openUntilMs = 0;
  openReason = "";
}
