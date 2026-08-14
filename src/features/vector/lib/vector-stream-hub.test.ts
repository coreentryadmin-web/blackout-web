import { before, describe, mock, test } from "node:test";
import assert from "node:assert/strict";

let buildCount = 0;

mock.module("./vector-snapshot", {
  namedExports: {
    buildVectorStreamPayload: async (ticker: string) => {
      buildCount++;
      if (buildCount === 1) {
        await new Promise((r) => setTimeout(r, 40));
      }
      return {
        ticker,
        wallHistory: [{ t: buildCount, callWalls: [], putWalls: [] }],
      };
    },
  },
});

describe("vector-stream-hub", () => {
  let hub: typeof import("./vector-stream-hub");

  before(async () => {
    hub = await import("./vector-stream-hub");
    hub._resetVectorStreamHubForTest();
    buildCount = 0;
  });

  test("coalesces overlapping refreshTickerHub calls into a follow-up build", async () => {
    hub.attachVectorStreamSubscriber("SPX");
    const first = hub.warmVectorStreamHub("SPX");
    const second = hub.warmVectorStreamHub("SPX");
    await Promise.all([first, second]);
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(buildCount, 2, "second refresh should run after the first completes");
    hub.detachVectorStreamSubscriber("SPX");
    hub._resetVectorStreamHubForTest();
  });
});
