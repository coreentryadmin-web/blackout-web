import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { Socket } from "node:net";
import { __allowFetchHostForTest } from "../../../lib/api-tracked-fetch";

// Proves buildTechnicalCard actually terminates the real underlying connections when its caller
// aborts -- through fetchPolygonMtfTechnicals's whole fan-out (fetchAggBars x3, fetchPreviousDayBar,
// fetchStockLastTrade, fetchStockLastNbbo in the first parallel batch; fetchPolygonEma x3,
// fetchPolygonRsi x2, fetchPolygonMacd, plus 2 more ema/rsi in the second) -> each one's own
// polygonGet -> polygonTrackedFetch -> the real fetch(). Before this fix, none of these accepted
// a signal at all, so an aborted buildTechnicalCard call left every one of those real connections
// running untouched.
//
// fetchPolygonMtfTechnicals awaits its first batch of 6 parallel calls BEFORE starting the second
// batch of 9 -- so aborting while the first batch is in flight also pre-empts the second batch
// (each of its fetch() calls sees an already-aborted signal and rejects immediately, without ever
// opening a connection). That means only the FIRST batch's up-to-6 connections are ever expected
// to reach the server in this test, which is asserted explicitly below rather than assumed.
//
// One shared server + one shared import for the whole file, deliberately -- POLYGON_API_BASE is
// read once at polygon-largo.ts's module evaluation, so a per-test cache-busted re-import doesn't
// give an isolated server the way it looks like it should (same trap documented in
// polygon-largo-cancellation.test.ts / polygon-short-interest-cancellation.test.ts).
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
  // Never respond -- every test below aborts before a real Polygon would ever have answered.
});
server.on("connection", (sock) => {
  sockets.push(sock);
});

function waitForConnectionCount(atLeast: number, timeoutMs: number): Promise<Socket[]> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      if (sockets.length >= atLeast) return resolve(sockets.slice());
      if (Date.now() >= deadline) return resolve(sockets.slice());
      setTimeout(tick, 2);
    };
    tick();
  });
}

function waitForAllSocketsClosed(socks: Socket[], timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tick = () => {
      if (socks.every((s) => s.destroyed)) return resolve(true);
      if (Date.now() >= deadline) return resolve(false);
      setTimeout(tick, 5);
    };
    tick();
  });
}

const basePromise = listen(server).then((base) => {
  process.env.POLYGON_API_BASE = base; // read once, at the top of the module evaluation below
  return base;
});

const technicalsPromise = basePromise.then(() => import("./technicals"));

after(() => {
  server.close();
});

test("buildTechnicalCard: aborting the caller's signal terminates every real underlying connection", async () => {
  const { buildTechnicalCard } = await technicalsPromise;
  const sinceCount = sockets.length;

  const controller = new AbortController();
  const pending = buildTechnicalCard("AAPL", controller.signal);
  pending.catch(() => {});

  // fetchPolygonMtfTechnicals's first Promise.all batch fires 6 parallel real fetches
  // (fetchAggBars daily/hourly/15m, fetchPreviousDayBar, fetchStockLastTrade, fetchStockLastNbbo).
  const connected = await waitForConnectionCount(sinceCount + 6, 3000);
  assert.equal(
    connected.length - sinceCount,
    6,
    "all 6 of the first batch's requests must actually reach the server for this test to prove anything"
  );
  const abortedAt = Date.now();
  controller.abort();

  await pending;
  // The real distinguishing signal (see this file's own header note): without the fix, `pending`
  // only resolves once trackedFetch's own unrelated default timeout finally fires for every one
  // of the 6 in-flight requests, because awaiting a promise that only settles once the connections
  // HAVE closed makes a bare close-check trivially true regardless of what actually closed them.
  // Bounding how long `pending` itself took to settle is what actually proves the abort was honored.
  assert.ok(
    Date.now() - abortedAt < 3000,
    `buildTechnicalCard must resolve promptly after its own signal aborts, not wait out an unrelated fetch timeout; took ${Date.now() - abortedAt}ms`
  );

  // `pending` having settled means fetchPolygonMtfTechnicals's SECOND Promise.all batch (9 more
  // indicator calls) has also already fired -- each with an already-aborted signal by then, so
  // whether a given call's underlying fetch() manages to open a socket before observing that
  // (an undici-internal timing detail, not something this fix controls) is not the claim under
  // test here. What IS under test: every socket that got opened anywhere in this whole call,
  // first batch or second, must have been torn down -- never left dangling.
  const allOpened = sockets.slice(sinceCount);
  assert.ok(allOpened.length >= 6, "expected at least the first batch's 6 connections to appear");
  const allClosed = await waitForAllSocketsClosed(allOpened, 3000);
  assert.equal(
    allClosed,
    true,
    "aborting buildTechnicalCard's own signal must terminate EVERY real connection its whole fan-out opened, none left dangling"
  );
});
