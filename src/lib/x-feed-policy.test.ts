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

  it("blocks an @tag hidden past line 1, not just on the first line", () => {
    // The AI-written body is never guaranteed single-line, and the trusted Whop footer is always
    // appended as its OWN last line after this check used to stop looking — so a mention on line 2
    // of the body (before the footer) must still be caught, same as one on line 1.
    assert.equal(
      isTimelinePostAllowed(
        "Good read on SPX today.\nShoutout @randomtrader for the free tip!\n@BlackOutTrade · link in bio",
      ),
      false,
    );
  });

  it("still allows a normal multi-line desk post whose only mention is the self-tag footer", () => {
    assert.equal(
      isTimelinePostAllowed(
        "SPX $6312 negative gamma below flip.\nFull desk live, flow confirms the read.\n@BlackOutTrade · link in bio",
      ),
      true,
    );
  });
});
