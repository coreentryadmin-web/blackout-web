import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LARGO_ESCALATION_MODEL, LARGO_MODEL, modelRejectsSamplingParams } from "./anthropic";

describe("Largo model defaults", () => {
  it("LARGO_MODEL is Sonnet 5 for desk synthesis quality", () => {
    assert.equal(LARGO_MODEL, "claude-sonnet-5");
  });

  it("LARGO_ESCALATION_MODEL stays Sonnet 4.6 for optional deep turns", () => {
    assert.equal(LARGO_ESCALATION_MODEL, "claude-sonnet-4-6");
  });
});

describe("sampling-param rejection", () => {
  // The whole point of this predicate is that LARGO_MODEL is now on the rejecting side of it.
  // Asserting the constant directly (rather than the literal) means a future model bump cannot
  // move Largo onto a rejecting model while leaving temperature attached.
  it("covers the model Largo actually runs on", () => {
    assert.equal(modelRejectsSamplingParams(LARGO_MODEL), true);
  });

  for (const m of ["claude-sonnet-5", "claude-opus-5", "claude-opus-4-7", "claude-fable-5"]) {
    it(`rejects for ${m}`, () => assert.equal(modelRejectsSamplingParams(m), true));
  }

  // 4.x still accepts temperature. `claude-sonnet-4-5` is the trap case: a loose 5-family pattern
  // would match its trailing -5 and silently strip a param the model supports.
  for (const m of ["claude-sonnet-4-6", "claude-sonnet-4-5", "claude-haiku-4-5", "claude-opus-4-5"]) {
    it(`allows for ${m}`, () => assert.equal(modelRejectsSamplingParams(m), false));
  }
});
