import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { thermalDiscordBypassesDedup } from "./thermal-discord-dedup";

describe("thermalDiscordBypassesDedup", () => {
  it("keeps EventBridge / bare force hits under the Redis claim", () => {
    assert.equal(thermalDiscordBypassesDedup(false, false), false);
    assert.equal(thermalDiscordBypassesDedup(true, false), false);
    assert.equal(thermalDiscordBypassesDedup(false, true), false);
  });

  it("only force+allow_dup skips the claim (intentional smoke)", () => {
    assert.equal(thermalDiscordBypassesDedup(true, true), true);
  });
});
