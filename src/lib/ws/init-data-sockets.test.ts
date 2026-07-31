import { test, mock, afterEach } from "node:test";
import assert from "node:assert/strict";

const ensurePollerCalls: number[] = [];

mock.module("./uw-socket", {
  namedExports: {
    ensureUwClusterFreshnessPoller: () => {
      ensurePollerCalls.push(Date.now());
    },
    initUwSocket: () => {},
    shutdownUwSocket: () => {},
  },
});

mock.module("./polygon-socket", {
  namedExports: {
    initPolygonSocket: () => {},
    shutdownPolygonSocket: () => {},
  },
});

mock.module("./options-socket", {
  namedExports: {
    initOptionsSocket: () => {},
    shutdownOptionsSocket: () => {},
  },
});

mock.module("./stocks-socket", {
  namedExports: {
    initStocksSocket: () => {},
    shutdownStocksSocket: () => {},
  },
});

afterEach(() => {
  ensurePollerCalls.length = 0;
  delete process.env.PROCESS_ROLE;
  delete process.env.DATA_SOCKETS_ENABLED;
});

test("ensureDataSockets on web tier starts cluster freshness poller without UW socket", async () => {
  process.env.PROCESS_ROLE = "web";
  const { ensureDataSockets } = await import("./init-data-sockets");
  ensureDataSockets();
  assert.equal(ensurePollerCalls.length, 1);
});
