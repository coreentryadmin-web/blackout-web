import { test, mock } from "node:test";
import assert from "node:assert/strict";

// Regression for a live bug (found 2026-10-25, Ask Largo/5-engine standing mandate): three of the
// four Redis read sites for the shared `spx-play-read:<date>` cache key returned whatever
// sharedCacheGetWithTtl found unconditionally, trusting its Redis-native `ttl > 0` gate alone, with
// NO check against the route's own `playMemberPeekMaxAgeSec()` freshness bound. peekSpxPlayState
// (the fourth reader of the identical key) already enforced that bound via
// isSpxPlaySnapshotFreshEnough. Live polling of GET /api/market/spx/play caught snapshots up to
// ~24 minutes stale served non-monotonically across sequential polls -- the exact
// "divergent grade/score/direction across replicas" failure evaluateSpxPlayStateCrossReplica's own
// cross-replica lock exists to prevent. This suite exercises the lock-not-won branch of
// evaluateSpxPlayStateCrossReplica (one of the three fixed call sites) with a stale cached hit and
// asserts the stale value is rejected rather than served.
//
// FOLLOW-UP regression (same day, 2026-10-25): that fix applied the freshness bound
// unconditionally, which over-corrects for the CLOSED-MARKET case. evaluateSpxPlayCore's
// closed-market branch (spx-play-engine.ts) deliberately stamps `as_of` from the desk snapshot's
// own timestamp, not eval time -- a 20s bound can never pass against that legitimately-old stamp
// by design, so every closed-market cached snapshot was rejected and forced a redundant
// re-evaluation on every contended request (defeating the single-flight cache this lock exists to
// provide), without fixing anything. `isSpxPlaySnapshotShareable` trusts a `session_phase:
// "closed"` snapshot regardless of age while still bounding a live-market one -- see
// spx-play-freshness.test.ts for the pure-function unit tests of that predicate; these two tests
// exercise it live through `evaluateSpxPlayStateCrossReplica` as the finding specifically asked for.

let getWithTtlResult: { value: unknown; remainingTtlSec: number } | null = null;

// spx-service.ts's own import graph pulls in "server-only"-guarded provider modules that throw
// when required outside Next's server bundler -- same reason spx-service-cross-replica-lock.test.ts
// stubs this out.
mock.module("server-only", { namedExports: {} });

mock.module("../../../lib/shared-cache", {
  namedExports: {
    sharedCacheSetNx: async () => false, // lock not won -- exercises the stale-read branch
    sharedCacheSet: async () => undefined,
    sharedCacheDel: async () => undefined,
    sharedCacheGetWithTtl: async () => getWithTtlResult,
  },
});

function snapshotWithAsOf(asOfIso: string, sessionPhase: "cash" | "closed" | "premarket" = "cash") {
  return {
    as_of: asOfIso,
    assessed: true,
    score: -11,
    direction: "short",
    factors: [{ name: "Session window", weight: -6 }],
    session_phase: sessionPhase,
  };
}

test("evaluateSpxPlayStateCrossReplica rejects a stale LIVE-MARKET cached snapshot instead of serving it (lock-not-won branch; PR #6719's own fix, unchanged)", async () => {
  // ~24 minutes stale -- the exact magnitude live-reproduced in production, ~71x the route's
  // default 20s freshness bound (SPX_PLAY_MEMBER_PEEK_MAX_AGE_SEC). session_phase: "cash" (the
  // default) marks this as a live-market snapshot, so the real freshness bound must still apply.
  const staleAsOf = new Date(Date.now() - 24 * 60 * 1000).toISOString();
  getWithTtlResult = { value: snapshotWithAsOf(staleAsOf), remainingTtlSec: 5 };

  const { evaluateSpxPlayStateCrossReplica } = await import("./spx-service");
  const result = await evaluateSpxPlayStateCrossReplica();

  assert.notEqual(
    (result as { as_of: string }).as_of,
    staleAsOf,
    "a 24-minute-stale LIVE-MARKET cached snapshot must not be served as the current play state"
  );
});

test("evaluateSpxPlayStateCrossReplica serves a cached snapshot that IS within the freshness bound (no regression)", async () => {
  const freshAsOf = new Date(Date.now() - 5 * 1000).toISOString(); // 5s old, well inside the 20s bound
  getWithTtlResult = { value: snapshotWithAsOf(freshAsOf), remainingTtlSec: 5 };

  const { evaluateSpxPlayStateCrossReplica } = await import("./spx-service");
  const result = await evaluateSpxPlayStateCrossReplica();

  assert.equal(
    (result as { as_of: string }).as_of,
    freshAsOf,
    "a genuinely fresh cached snapshot must still be served (the fix must not reject everything)"
  );
});

test("evaluateSpxPlayStateCrossReplica serves a stale CLOSED-MARKET cached snapshot instead of forcing a redundant re-evaluation (lock-not-won branch)", async () => {
  // Same ~24-minute staleness as the live-market case above, but session_phase: "closed" --
  // evaluateSpxPlayCore's closed-market branch deliberately stamps as_of from the desk snapshot's
  // own (old) timestamp, so this age is legitimate by design, not evidence of a stale cache.
  const closedAsOf = new Date(Date.now() - 24 * 60 * 1000).toISOString();
  getWithTtlResult = { value: snapshotWithAsOf(closedAsOf, "closed"), remainingTtlSec: 5 };

  const { evaluateSpxPlayStateCrossReplica } = await import("./spx-service");
  const result = await evaluateSpxPlayStateCrossReplica();

  assert.equal(
    (result as { as_of: string }).as_of,
    closedAsOf,
    "a closed-market snapshot must be served as-is, not rejected purely for being old"
  );
});
