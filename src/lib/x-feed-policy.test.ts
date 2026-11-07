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

  it("blocks an @tag riding the SAME line as the trusted self-tag footer (2026-11-07)", () => {
    // Root cause: the self-tag exemption used to be a whole-LINE `includes("@BlackOutTrade")`
    // check, not a per-mention one. A line carrying BOTH the trusted self-tag and a cold @tag of
    // another account ("@BlackOutTrade and @someone else") used to short-circuit the entire line
    // as exempt the moment it saw "@BlackOutTrade" anywhere in it, never separately inspecting the
    // other mention — letting the exact spam pattern this function exists to reject (tagging
    // another account on an original timeline post) slip through uncaught whenever it happened to
    // share a line with the footer.
    assert.equal(
      isTimelinePostAllowed("Check this out\n@BlackOutTrade and @someone else"),
      false,
      "an @tag of another account must be caught even when it shares a line with the self-tag footer",
    );
    assert.equal(
      isTimelinePostAllowed("Nice read\nThanks @BlackOutTrade for the heads up @randomguy"),
      false,
      "a cold @tag before the self-tag on the same line must also be caught",
    );
    // The self-tag ALONE on a line, possibly repeated, must still be allowed.
    assert.equal(
      isTimelinePostAllowed("SPX desk live.\n@BlackOutTrade @BlackOutTrade · link in bio"),
      true,
      "the self-tag by itself (even duplicated) on one line must not be rejected",
    );
  });
});
