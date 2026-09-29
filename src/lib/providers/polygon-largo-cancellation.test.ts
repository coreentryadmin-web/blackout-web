import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { Socket } from "node:net";
import { __allowFetchHostForTest } from "../api-tracked-fetch";

// Proves fetchPolygonNews/fetchPolygonTickerDetails actually terminate the real underlying
// connection when their caller aborts — through polygonGet -> buildPolygonLargoFetchInit ->
// polygonTrackedFetch -> the real fetch(). One shared server + one shared import for the
// whole file, deliberately: POLYGON_API_BASE is read once at polygon-largo.ts's module
// evaluation (`getPolygonBase()`'s closure), so a per-test cache-busted re-import doesn't
// give an isolated server the way it looks like it should — this loader resolves a
// query-string variant of the same specifier back to the SAME cached module instance
// (verified against the identical trap in unusual-whales-abort-wiring.test.ts).
process.env.POLYGON_API_KEY = "test-polygon-key";
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
  // Never respond — every test below aborts before a real Polygon would ever have answered.
});
server.on("connection", (sock) => {
  sockets.push(sock);
});

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
  process.env.POLYGON_API_BASE = base; // read once, at the top of the module evaluation below
  return base;
});

const polygonLargoPromise = basePromise.then(() => import("./polygon-largo"));

after(() => {
  server.close();
});

test("fetchPolygonNews: aborting the caller's signal terminates the real underlying connection", async () => {
  const { fetchPolygonNews } = await polygonLargoPromise;
  const sinceCount = sockets.length;

  const controller = new AbortController();
  const pending = fetchPolygonNews("AAPL", 15, controller.signal);
  pending.catch(() => {});

  const socket = await waitForNextConnection(sinceCount, 2000);
  assert.ok(socket, "the request must actually reach the server for this test to prove anything");
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
  const { fetchPolygonTickerDetails } = await polygonLargoPromise;
  const sinceCount = sockets.length;

  const controller = new AbortController();
  const pending = fetchPolygonTickerDetails("AAPL", controller.signal);
  pending.catch(() => {});

  const socket = await waitForNextConnection(sinceCount, 2000);
  assert.ok(socket, "the request must actually reach the server for this test to prove anything");
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
