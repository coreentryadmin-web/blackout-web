/**
 * Recognising the provider's "you are out of WebSocket connections" frame.
 *
 * THE BUG THIS EXISTS FOR (measured live 2026-08-09). Polygon/Massive caps WebSocket connections
 * per ACCOUNT. When the cap is reached the server does NOT refuse the handshake — it completes it,
 * accepts the auth, accepts the subscribe, and only then sends:
 *
 *   {"ev":"status","status":"connected",   "message":"Connected Successfully"}
 *   {"ev":"status","status":"auth_success","message":"authenticated"}
 *   {"ev":"status","status":"success",     "message":"subscribed to: A.AAPL"}
 *   {"ev":"status","status":"max_connections","message":"Maximum number of websocket connections exceeded..."}
 *   -> close 1008
 *
 * Every socket in this codebase resets its reconnect backoff on `auth_success` (polygon-socket
 * `indicesReconnectDelay = 1000; indicesConsecutiveFailures = 0`, and the same shape in
 * stocks-socket and options-socket). None of them had a branch for `max_connections`. So the cycle
 * was: connect -> auth_success (backoff reset to 1s) -> refused -> close -> reconnect ~1s later ->
 * repeat. A permanent hot loop at roughly one attempt per second, where the escalation to a 60s
 * delay can NEVER fire because every cycle looks like a fresh success.
 *
 * That is worse than wasted retries: each attempt briefly occupies a connection slot, so a process
 * stuck in this loop competes with the connections that are actually working — including its own
 * siblings after a deploy. It is a plausible mechanism for an account sitting pinned at its cap.
 *
 * A cap is an ACCOUNT-level condition. No amount of retrying fixes it, and retrying fast makes it
 * worse, so the correct response is a long cooldown plus a loud, greppable log — not a backoff
 * curve tuned for transient network faults.
 */

/** Cooldown after a refusal. Long enough to stop competing for slots, short enough to recover
 *  automatically once whatever held the connections lets go (a deploy draining, a task exiting). */
export const WS_CONNECTION_CAP_COOLDOWN_MS = 60_000;

/**
 * True when a provider status frame means "no connection slots left for this account".
 *
 * Matched on the documented `max_connections` status first, then on message text, because the two
 * providers word it differently and a future one will word it differently again. Deliberately
 * narrow: it must not swallow `auth_failed` (a key problem, which needs a different response) or a
 * generic error.
 */
export function isConnectionCapFrame(msg: unknown): boolean {
  if (!msg || typeof msg !== "object") return false;
  const m = msg as { ev?: unknown; status?: unknown; message?: unknown };
  const status = typeof m.status === "string" ? m.status.toLowerCase() : "";
  if (status === "max_connections") return true;
  const text = typeof m.message === "string" ? m.message.toLowerCase() : "";
  if (!text) return false;
  return (
    text.includes("maximum number of websocket connections") ||
    text.includes("connection limit for your account")
  );
}

/**
 * Reconnect delay to use after a close, given whether the connection was refused for capacity.
 *
 * Capacity refusals ignore the caller's normal curve entirely — the curve exists to ride out
 * transient faults, and a cap is not transient.
 */
export function reconnectDelayAfterClose(
  normalDelayMs: number,
  cappedRecently: boolean,
  cooldownMs = WS_CONNECTION_CAP_COOLDOWN_MS
): number {
  if (!cappedRecently) return normalDelayMs;
  return Math.max(normalDelayMs, cooldownMs);
}

/**
 * Minimum time a connection must SURVIVE before it counts as stable enough to reset the backoff.
 *
 * Ten seconds is comfortably longer than a refuse-after-handshake round trip (the Polygon cap
 * sequence completes in ~1-2s) and far shorter than any healthy session.
 */
export const WS_MIN_STABLE_MS = 10_000;

/**
 * Whether a fresh socket OPENING should reset the reconnect backoff.
 *
 * uw-socket resets `reconnectDelay = 1000` in `onopen`, before a single frame has arrived. That is
 * the same defect as resetting on `auth_success`, one step earlier and provider-independent: any
 * condition that lets the socket open and then closes it promptly — a capacity refusal, a rejected
 * subscription, a server-side auth teardown — resets the curve every cycle, so the backoff can
 * never grow and the socket flaps at roughly one attempt per second indefinitely.
 *
 * Opening proves the TCP/TLS path works. It does not prove the connection is useful. So the reset
 * is gated on the PREVIOUS connection having survived `minStableMs`; a first attempt (no previous
 * duration) resets, because there is nothing yet to suspect.
 */
export function shouldResetBackoffOnOpen(
  previousConnectionMs: number | null | undefined,
  minStableMs = WS_MIN_STABLE_MS
): boolean {
  if (previousConnectionMs == null || !Number.isFinite(previousConnectionMs)) return true;
  return previousConnectionMs >= minStableMs;
}

/**
 * Whether `auth_success` should reset the backoff.
 *
 * It should NOT when this connection has already been told the account is capped: the handshake
 * succeeding is exactly what makes a capped connection look healthy, and treating it as success is
 * what turns the refusal into an unbounded loop.
 */
export function shouldResetBackoffOnAuth(cappedThisConnection: boolean): boolean {
  return !cappedThisConnection;
}
