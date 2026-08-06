import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LARGO_ESCALATION_MODEL, LARGO_MODEL } from "./anthropic";

describe("Largo model defaults", () => {
  it("LARGO_MODEL is Haiku for cost-efficient desk replies", () => {
    assert.equal(LARGO_MODEL, "claude-haiku-4-5");
  });

  it("LARGO_ESCALATION_MODEL stays Sonnet for optional deep turns", () => {
    assert.equal(LARGO_ESCALATION_MODEL, "claude-sonnet-4-6");
  });
});
