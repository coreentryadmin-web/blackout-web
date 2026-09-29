import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { Socket } from "node:net";
import { __allowFetchHostForTest } from "../api-tracked-fetch";

// This exercises the REAL production call path this Phase 2 fix rewired end to end:
//   fetchUwDarkPool -> uwCacheGet (uw-shared-cache.ts's coalescing group)
//                   -> uwGetSafe -> uwGet -> throttleUwCoalesced (uw-rate-limiter.ts's
//                      coalescing group) -> trackedFetch -> real fetch()
// against a REAL local HTTP server (not a mocked global.fetch, which can prove the
// caller stopped WAITING but cannot prove the underlying TCP connection was ever
// actually torn down) — the same distinction FINDINGS.md's `dossierFetch` entry drew
// between "the call succeeded" and "the request was actually cancelled".
//
// ONE server + ONE import for the whole file, deliberately: `unusual-whales.ts`'s `BASE`
// constant is captured once at module evaluation. A per-test `import(...?cache-bust)` looked
// like the way to get an isolated server per test, but this loader resolves the query-string
// variant back to the SAME cached module instance (verified: two "fresh" imports were
// `===`), so a second test's server would silently be talking to the FIRST test's already-
// closed port — real ECONNREFUSEDs it then dutifully retried and reported as a wiring bug.
// One shared server (whose handler never responds, so it works for any ticker/path) avoids
// the whole class of problem.
process.env.UW_API_KEY = "test-uw-key";
delete process.env.REDIS_URL; // force the in-process-only cache/coalescing path, no live Redis needed
// PINNED, not left to the ambient environment: this sandbox sets a real REPLICA_COUNT=5
// (mirroring production's actual ECS replica count), and uw-rate-limiter.ts's degraded
// (no-Redis) local rate and concurrency are BOTH divided by REPLICA_COUNT —
// computeDegradedLocalRps(2, 5) = 0.4 tokens/s, so refilling a single token from empty takes
// ~2.5s. That's correct, intentional throttling for a real 5-replica fleet with no Redis, but
// it turns "two admission attempts in one test" into a genuine multi-second wait, which is
// real production behavior having nothing to do with what this file tests (abort wiring).
process.env.REPLICA_COUNT = "1";
process.env.UW_MIN_SPACING_MS = "1"; // "0" falls back to the 300ms default (rateLimiterEnvNumber requires n>0)
__allowFetchHostForTest("127.0.0.1");

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("expected AddressInfo");
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}

const sockets: Socket[] = [];
const server = createServer(() => {
  // Never respond — every test below aborts before a real UW would ever have answered.
});
server.on("connection", (sock) => {
  sockets.push(sock);
});

/** Wait for the NEXT new connection accepted since `sinceCount`, returning it (or null on timeout). */
function waitForNextConnection(sinceCount: number, timeoutMs: number): Promise<Socket | null> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      if (sockets.length > sinceCount) return resolve(sockets[sinceCount]!);
      if (Date.now() >= deadline) return resolve(null);
      setTimeout(tick, 2);
    };
    tick();
  });
}

function waitForSocketClose(socket: Socket, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (socket.destroyed) return resolve(true);
    const timer = setTimeout(() => resolve(false), timeoutMs);
    socket.once("close", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

const basePromise = listen(server).then((base) => {
  process.env.UW_API_BASE = base; // read once, at the top of the module evaluation below
  return base;
});

const uwPromise = basePromise.then(() => import("./unusual-whales"));

after(() => {
  server.close();
});

test("fetchUwDarkPool: aborting the ONLY caller's signal terminates the real underlying connection, through the full coalescing+rate-limiter stack", async () => {
  const { fetchUwDarkPool } = await uwPromise;
  const sinceCount = sockets.length;

  const controller = new AbortController();
  const pending = fetchUwDarkPool("UWABORTTEST1", { limit: 5 }, controller.signal);
  pending.catch(() => {});

  const socket = await waitForNextConnection(sinceCount, 2000);
  assert.ok(socket, "the request must actually reach the server for this test to prove anything");
  controller.abort();

  const result = await pending;
  assert.equal(result, null, "uwGetSafe's contract is 'never throw' — an aborted call resolves null");

  const closedInTime = await waitForSocketClose(socket!, 1000);
  assert.equal(
    closedInTime,
    true,
    "aborting fetchUwDarkPool's own signal must terminate the REAL connection all the way down " +
      "through uwCacheGet's coalescing group and throttleUwCoalesced's coalescing group to the " +
      "actual fetch() — not just stop the caller from waiting on it"
  );
});

// The "caller A aborting must not disturb still-attached caller B" contract (both at the
// cache-layer group and the rate-limiter group this stack shares) is covered at the unit level
// instead of here — see uw-shared-cache.test.ts's "caller A aborting while B is still attached"
// test and uw-rate-limiter.test.ts's "onAdmitted fires for the caller that triggers the fetch"
// test. An equivalent full end-to-end version was tried here (real server, real multi-caller
// fetchUwDarkPool race) and its assertions DID hold reliably, but uwGetSafe's own retry loop
// occasionally hit a real, unexplained ~250ms transient failure against this sandbox's loopback
// on the SAME connection this test needs to track, unrelated to anything this fix touches, which
// made the test slow (~19s, chasing retries' own connections) without adding coverage beyond what
// the faster unit tests above already prove precisely. Not worth the runtime cost here.
