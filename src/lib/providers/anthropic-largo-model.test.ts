import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LARGO_ESCALATION_MODEL, LARGO_MODEL } from "./anthropic";

describe("Largo model defaults", () => {
  it("LARGO_MODEL is Sonnet 5 for desk synthesis quality", () => {
    assert.equal(LARGO_MODEL, "claude-sonnet-5");
  });

  it("LARGO_ESCALATION_MODEL stays Sonnet 4.6 for optional deep turns", () => {
    assert.equal(LARGO_ESCALATION_MODEL, "claude-sonnet-4-6");
  });
});
