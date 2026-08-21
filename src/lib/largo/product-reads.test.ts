import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";

mock.module("server-only", { namedExports: {} });

let bangerBoardForLargo: typeof import("./product-reads").bangerBoardForLargo;
let nighthawkHorizonsForLargo: typeof import("./product-reads").nighthawkHorizonsForLargo;

before(async () => {
  ({ bangerBoardForLargo, nighthawkHorizonsForLargo } = await import("./product-reads"));
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

// A bare UTC `as_of` reads a full session ahead between ~20:00 ET and midnight. Both of
// these payloads are session-scoped — banger rows are keyed by session_date, and the 0DTE
// counts answer "how many are open TODAY" — so the session has to be stated, not inferred.
describe("session anchors (Largo product contract C1)", () => {
  it("banger board states its ET session alongside the UTC instant", async () => {
    const prev = process.env.BANGER_ENGINE_ENABLED;
    process.env.BANGER_ENGINE_ENABLED = "1";
    try {
      const r = (await bangerBoardForLargo()) as Record<string, unknown>;
      if (r.available === false) return; // db-less environment: nothing to anchor
      assert.match(String(r.as_of), /^\d{4}-\d{2}-\d{2}T.*Z$/);
      assert.match(String(r.session_date), /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(String(r.as_of_et).slice(0, 10), r.session_date);
    } finally {
      if (prev === undefined) delete process.env.BANGER_ENGINE_ENABLED;
      else process.env.BANGER_ENGINE_ENABLED = prev;
    }
  });

  it("nighthawk horizons states its ET session alongside the UTC instant", async () => {
    const r = (await nighthawkHorizonsForLargo()) as Record<string, unknown>;
    assert.match(String(r.as_of), /^\d{4}-\d{2}-\d{2}T.*Z$/);
    assert.match(String(r.session_date), /^\d{4}-\d{2}-\d{2}$/);
    assert.match(String(r.as_of_et), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} ET$/);
    assert.equal(String(r.as_of_et).slice(0, 10), r.session_date);
  });
});
