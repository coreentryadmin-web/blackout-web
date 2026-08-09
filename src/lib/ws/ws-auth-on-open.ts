/**
 * Authenticating a provider socket from OUR connection lifecycle, never from a frame the server
 * sends us.
 *
 * WHY THIS EXISTS. All three Polygon/Massive sockets used to send the API key from inside the
 * message handler, gated on the server's `{"ev":"status","status":"connected"}` frame. CodeQL's
 * js/user-controlled-bypass flags that shape: remote input decides whether a credential is sent.
 * The concrete risk here is low — the peer is TLS-pinned by URL, and the frame controls *when* the
 * key is sent, never *where* — but the principle is sound, and "a remote frame gates the
 * credential" is not a shape worth keeping once there is a strictly better one.
 *
 * There is one, and it was already running in production: `options-socket.ts` has authenticated in
 * `onopen` (not on the frame) since it was written, precisely because "during rolling deploys the
 * server can drop a slow socket with 1006 before the first message arrives". Its frame-gated send
 * was therefore already a redundant second copy. This module generalises that proven pattern to the
 * other two sockets, so the frame-gated send can be deleted everywhere.
 *
 * The retry is what makes the deletion provably non-regressive. If a provider ever ignored an auth
 * frame sent before it announced `connected`, the old code would still have authenticated on the
 * frame and the new code would not — so instead of trusting that early auth is always accepted, we
 * re-send once after a grace period if no ack arrived. The worst case is one duplicate auth frame
 * on a socket that already authenticated, which providers ignore.
 */

/** Grace before re-sending auth. Comfortably longer than a handshake round trip (~100-300ms to a
 *  US endpoint) so the retry only fires when the first send genuinely produced no ack. */
export const WS_AUTH_RETRY_MS = 3_000;

export type AuthOnOpenOptions = {
  /** Send the provider's auth frame. Called immediately, and again after `retryMs` if needed. */
  send: () => void;
  /** Has the server acked auth on THIS connection yet? */
  isAuthenticated: () => boolean;
  /** Is this still the live socket AND open? Guards against a retry landing on a socket that has
   *  since been superseded by a reconnect — sending on the wrong socket is the bug this prevents. */
  isCurrentAndOpen: () => boolean;
  retryMs?: number;
  /** Timer factory — injected so tests can drive it without real time. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

/**
 * Send auth now, and once more after the grace period if the server has not acked.
 *
 * Returns a cancel function: call it from the socket's close/teardown path so a pending retry can
 * never fire against a dead or replaced socket.
 */
export function authOnOpen(opts: AuthOnOpenOptions): () => void {
  const {
    send,
    isAuthenticated,
    isCurrentAndOpen,
    retryMs = WS_AUTH_RETRY_MS,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  } = opts;

  if (isCurrentAndOpen()) send();

  const handle = setTimer(() => {
    // Three conditions, all required: still the live socket, still open, still unauthenticated.
    if (!isCurrentAndOpen()) return;
    if (isAuthenticated()) return;
    send();
  }, retryMs);

  // unref where available so a pending retry never holds the process open at shutdown.
  (handle as { unref?: () => void })?.unref?.();

  return () => clearTimer(handle);
}
