import { before, test, mock } from "node:test";
import assert from "node:assert/strict";

// Regression for the last unmigrated sharedCacheSetNx caller left after PR #3960 changed the
// primitive to THROW on a live Redis command error instead of silently falling through to an
// in-memory "acquired" (see shared-cache.ts's own docblock). Every cron overlap-guard caller was
// updated to explicitly pick fail-open/fail-closed via .catch() — this one call site
// (evaluateSpxPlayStateCrossReplica's single-flight lock) was missed, so a live Redis error here
// would have propagated as an unhandled rejection out of a member-facing read path instead of
// falling through to the existing stale-cache/degraded fallback chain.

let setNxImpl: () => Promise<boolean> = async () => true;
let getWithTtlCalls = 0;

// spx-service.ts's own import graph pulls in "server-only"-guarded provider modules (transitively,
// several hops deep) that throw when required outside Next's server bundler — same reason several
// other spx-*.test.ts files stub this out (e.g. spx-signal-log-catalyst-shadow.test.ts). This
// suite never exercises that chain directly (evaluateSpxPlayState is never invoked on the
// won=false branch under test), so an empty stub is enough.
mock.module("server-only", { namedExports: {} });

mock.module("../../../lib/shared-cache", {
  namedExports: {
    sharedCacheSetNx: (..._args: unknown[]) => setNxImpl(),
    sharedCacheSet: async () => undefined,
    sharedCacheDel: async () => undefined,
    sharedCacheGetWithTtl: async () => {
      getWithTtlCalls++;
      return null; // no stale snapshot available
    },
  },
});

test("evaluateSpxPlayStateCrossReplica falls through to the degraded read when the Redis lock errors, instead of throwing", async () => {
  setNxImpl = () => Promise.reject(new Error("ECONNRESET"));
  getWithTtlCalls = 0;

  const { evaluateSpxPlayStateCrossReplica } = await import("./spx-service");

  // Must resolve, not reject — this is the regression this test guards.
  const result = await evaluateSpxPlayStateCrossReplica();

  assert.ok(result, "must return a degraded/fallback payload rather than throwing");
  assert.ok(getWithTtlCalls > 0, "must have attempted the stale-cache fallback path after losing the lock");
});
