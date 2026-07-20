import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isTimelinePostAllowed } from "./x-feed-policy";

describe("x-feed-policy", () => {
  it("blocks @tag spam on timeline", () => {
    assert.equal(
      isTimelinePostAllowed("@unusual_whales Respect — what's your 0DTE filter?"),
      false,
    );
    assert.equal(
      isTimelinePostAllowed(
        "SPX $6312 negative gamma below flip. Full desk live.\n@BlackOutTrade whop.com/blackout-2d9c",
      ),
      true,
    );
  });
});
