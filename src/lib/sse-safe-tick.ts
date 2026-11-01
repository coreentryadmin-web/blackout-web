// Pure, alias-free SSE tick wrapper. No DOM/runtime deps so it is unit-testable under
// tsx --test / node:test (unlike sse-stream-entitlement.ts, which pulls in
// tool-access-server.ts's `import "server-only"` and cannot be imported outside Next's
// RSC compiler).
//
// Every SSE stream route's per-tick `send()` is invoked fire-and-forget from a
// `setInterval` callback (`void send()`) with no `.catch()` anywhere in the chain — the
// only thing standing between recheckSseUserEntitlement's re-throw (any non-degraded-
// mode failure from resolveUserTier/userCanAccessTool, e.g. a genuine Clerk/Redis error)
// and an unhandled promise rejection was that re-throw never happening. It does happen:
// a live crash-level alert (2026-09-09, twice in ~20 minutes) confirmed a production
// tick actually rejecting this way. `send()` runs every 1s for the life of a long-lived
// connection, so once triggered this fires on EVERY tick until the client disconnects,
// not once.
//
// This is the single fix point for all three SSE stream routes (vector/stream,
// zerodte/marks/stream, flows/stream) rather than three duplicated try/catch blocks.
// Any unexpected error is treated the same way the existing "unavailable" verdict
// already is: skip this tick, try again next tick, never let it escape as an
// unhandled rejection.

export async function runSseTickSafely(tick: () => Promise<void>, routeLabel: string): Promise<void> {
  try {
    await tick();
  } catch (err) {
    console.error(`[sse-stream:${routeLabel}] tick failed unexpectedly:`, err);
  }
}
