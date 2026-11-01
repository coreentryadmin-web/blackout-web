import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  soundsLikeBot,
  deterministicHumanize,
} from "./x-content-humanize";
import * as xContentHumanize from "./x-content-humanize";

describe("x-content-humanize", () => {
  it("does not re-export the dead footer-splitting pair (splitContentWithFooter/stripFooter)", () => {
    // splitContentWithFooter was added in #848 (2026-07-20) alongside attachFooter
    // (its intended inverse) but attachFooter is the only one ever wired into a
    // caller (x-content.ts). splitContentWithFooter — and the private stripFooter
    // helper it alone called — had zero call sites anywhere in the repo from the
    // moment they were introduced. This guards against either being silently
    // re-added without ever being wired into a real caller.
    assert.equal(
      "splitContentWithFooter" in xContentHumanize,
      false,
      "splitContentWithFooter should stay removed unless a real caller wires it in",
    );
    assert.equal("attachFooter" in xContentHumanize, true);
  });

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
