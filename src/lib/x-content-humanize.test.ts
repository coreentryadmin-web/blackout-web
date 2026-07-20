import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  soundsLikeBot,
  deterministicHumanize,
} from "./x-content-humanize";

describe("x-content-humanize", () => {
  it("flags bot-like product spam", () => {
    assert.equal(
      soundsLikeBot(
        "Midday: Helix flow + Thermal + Vector + Largo + SPX Slayer + Night Hawk — one connected desk",
      ),
      true,
    );
    assert.equal(
      soundsLikeBot("SPX $6312 below flip at $6318. Dealers selling rips. What's your read?"),
      false,
    );
  });

  it("deterministicHumanize adds opener without deleting data", () => {
    const out = deterministicHumanize(
      "SPX $6312 negative gamma. Flip $6318.",
      { postType: "desk_midday" },
    );
    assert.match(out, /6312/);
    assert.match(out, /6318/);
  });
});
