import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { Socket } from "node:net";
import { __allowFetchHostForTest } from "../api-tracked-fetch";

// Proves fetchPolygonNews/fetchPolygonTickerDetails actually terminate the real underlying
// connection when their caller aborts — through polygonGet -> buildPolygonLargoFetchInit ->
// polygonTrackedFetch -> the real fetch(). One shared server + one shared import for the
// whole file: polygon-largo's module instance is cached across the full test run (tsx
// ignores query-string cache busts — see unusual-whales-abort-wiring.test.ts), so
// getPolygonBase() must read POLYGON_API_BASE at call time, not at module evaluation.
//
// Waits on inbound HTTP *requests*, not raw TCP `connection` events: undici keep-alive reuses
// one socket across sequential calls to the same mock origin, so a second subtest's fetch can
// reach the server without opening a new connection (CI flake: test 2 timed out at 2s while
// test 1's socket was reused).
process.env.POLYGON_API_KEY = "test-polygon-key";
__allowFetchHostForTest("127.0.0.1");

/** Under full-suite CI the Polygon admission queue can defer the TCP connect briefly. */
const CONNECTION_PROOF_WAIT_MS = process.env.CI ? 12_000 : 4_000;

async function resetPolygonCancellationHarness() {
  const { resetPolygonCircuitForTest } = await import("./polygon-rate-limiter");
  resetPolygonCircuitForTest();
  const { resetPolygonLargoRoutingForTest } = await polygonLargoPromise;
  resetPolygonLargoRoutingForTest();
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("expected AddressInfo");
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}

let inboundRequestCount = 0;
/** Socket serving the most recent inbound HTTP request (keep-alive reuses one TCP session). */
let lastRequestSocket: Socket | null = null;
const server = createServer((req) => {
  inboundRequestCount += 1;
  lastRequestSocket = req.socket;
  // Never respond — every test below aborts before a real Polygon would ever have answered.
});

function waitForNextInboundRequest(sinceCount: number, timeoutMs: number): Promise<Socket | null> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      if (inboundRequestCount > sinceCount) return resolve(lastRequestSocket);
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
  process.env.POLYGON_API_BASE = base; // read once, at the top of the module evaluation below
  return base;
});

const polygonLargoPromise = basePromise.then(async () => {
  const { resetPolygonCircuitForTest } = await import("./polygon-rate-limiter");
  resetPolygonCircuitForTest();
  const mod = await import("./polygon-largo");
  mod.resetPolygonLargoRoutingForTest();
  return mod;
});

after(() => {
  server.close();
});

test("fetchPolygonNews: aborting the caller's signal terminates the real underlying connection", async () => {
  await resetPolygonCancellationHarness();
  const { fetchPolygonNews } = await polygonLargoPromise;
  const sinceCount = inboundRequestCount;

  const controller = new AbortController();
  const pending = fetchPolygonNews("AAPL", 15, controller.signal);
  pending.catch(() => {});

  const socket = await waitForNextInboundRequest(sinceCount, CONNECTION_PROOF_WAIT_MS);
  assert.ok(
    socket,
    "the request must actually reach the server for this test to prove anything " +
      "(stale POLYGON_API_BASE from an early import or failover/breaker drift sends traffic elsewhere)"
  );
  const abortedAt = Date.now();
  controller.abort();

  const result = await pending;
  assert.deepEqual(result, [], "polygonGet's contract is 'never throw' -- an aborted call resolves to the empty-array fallback");
  // The real distinguishing signal (see this file's own header note): without the fix, `pending`
  // only resolves once trackedFetch's own unrelated default timeout finally fires (retried once,
  // so ~30s), because awaiting a promise that only settles once the connection HAS closed makes a
  // bare `waitForSocketClose` check trivially true regardless of what actually closed it. Bounding
  // how long `pending` itself took to settle is what actually proves the abort was honored.
  assert.ok(
    Date.now() - abortedAt < 2000,
    `fetchPolygonNews must resolve promptly after its own signal aborts, not wait out an unrelated fetch timeout; took ${Date.now() - abortedAt}ms`
  );

  const closedInTime = await waitForSocketClose(socket!, 1000);
  assert.equal(
    closedInTime,
    true,
    "aborting fetchPolygonNews's own signal must terminate the REAL connection through " +
      "polygonGet -> polygonTrackedFetch -> the actual fetch() call"
  );
});

test("fetchPolygonTickerDetails: aborting the caller's signal terminates the real underlying connection", async () => {
  await resetPolygonCancellationHarness();
  const { fetchPolygonTickerDetails } = await polygonLargoPromise;
  const sinceCount = inboundRequestCount;

  const controller = new AbortController();
  const pending = fetchPolygonTickerDetails("AAPL", controller.signal);
  pending.catch(() => {});

  const socket = await waitForNextInboundRequest(sinceCount, CONNECTION_PROOF_WAIT_MS);
  assert.ok(
    socket,
    "the request must actually reach the server for this test to prove anything " +
      "(stale POLYGON_API_BASE from an early import or failover/breaker drift sends traffic elsewhere)"
  );
  const abortedAt = Date.now();
  controller.abort();

  const result = await pending;
  assert.equal(result, null, "polygonGet's contract is 'never throw' -- an aborted call resolves null");
  assert.ok(
    Date.now() - abortedAt < 2000,
    `fetchPolygonTickerDetails must resolve promptly after its own signal aborts, not wait out an unrelated fetch timeout; took ${Date.now() - abortedAt}ms`
  );

  const closedInTime = await waitForSocketClose(socket!, 1000);
  assert.equal(closedInTime, true, "aborting fetchPolygonTickerDetails's own signal must terminate the REAL connection");
});
