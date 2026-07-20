import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMentionOutreachTweet } from "./x-engage-engine";

describe("buildMentionOutreachTweet", () => {
  it("tags real username with contextual question", () => {
    const t = buildMentionOutreachTweet(
      "drayinvests",
      "SPX 0DTE gamma flip watch today",
    );
    assert.match(t, /@drayinvests/);
    assert.match(t, /\?/);
    assert.doesNotMatch(t, /@there/);
  });
});
