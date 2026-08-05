import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";

mock.module("server-only", { namedExports: {} });

let bangerBoardForLargo: typeof import("./product-reads").bangerBoardForLargo;

before(async () => {
  ({ bangerBoardForLargo } = await import("./product-reads"));
});

describe("product-reads", () => {
  it("bangerBoardForLargo returns disabled when engine flag off", async () => {
    const prev = process.env.BANGER_ENGINE_ENABLED;
    process.env.BANGER_ENGINE_ENABLED = "0";
    try {
      const result = await bangerBoardForLargo();
      assert.equal(result.available, false);
      assert.equal(result.enabled, false);
    } finally {
      if (prev === undefined) delete process.env.BANGER_ENGINE_ENABLED;
      else process.env.BANGER_ENGINE_ENABLED = prev;
    }
  });
});
