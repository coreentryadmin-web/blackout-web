import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolvePinSpotInputs } from "./spx-pin-spot";

describe("resolvePinSpotInputs", () => {
  it("prefers a live pulse price when present", () => {
    const r = resolvePinSpotInputs(
      { price: 7428.78, prior_close: 7440 },
      { price: 7400, prior_close: 7390 }
    );
    assert.equal(r.spot, 7428.78);
    assert.equal(r.priorClose, 7440);
  });

  it("falls back to desk when pulse is off-hours price:0 (live 2026-07-28 regression)", () => {
    const r = resolvePinSpotInputs(
      { price: 0, prior_close: null },
      { price: 7428.78, prior_close: 7440.12 }
    );
    assert.equal(r.spot, 7428.78);
    assert.equal(r.priorClose, 7440.12);
  });

  it("never fabricates a spot when both lanes are empty", () => {
    const r = resolvePinSpotInputs({ price: 0, prior_close: null }, null);
    assert.equal(r.spot, 0);
    assert.equal(r.priorClose, null);
  });
});
