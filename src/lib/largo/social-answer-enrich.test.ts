import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { enrichSocialAnswerIfNeeded } from "./social-answer-enrich";

describe("enrichSocialAnswerIfNeeded", () => {
  it("appends Post section when missing", () => {
    const out = enrichSocialAnswerIfNeeded(
      "## Verdict\nSPX below flip — bearish gamma.",
      "Draft an X post for SPX setup",
      null,
      "SPX",
    );
    assert.match(out, /## Post/);
    assert.match(out, /\*\*Copy\*\*/);
    assert.match(out, /Screenshot workflow/);
  });

  it("does not duplicate when Post already present", () => {
    const answer = "## Post\n**Copy**\nAlready here — desk read is live with honest empty-state copy.";
    assert.equal(enrichSocialAnswerIfNeeded(answer, "X post", null), answer);
  });
});
