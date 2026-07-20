import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isTweetContentValid } from "./x-post-guard";

describe("isTweetContentValid", () => {
  const footer = "\n@BlackOutTrade blackouttrades.com/pricing?utm_source=x";

  it("rejects placeholder and spam patterns", () => {
    assert.equal(
      isTweetContentValid(
        "SPX, unknown gamma, flip flip" + footer,
      ),
      false,
    );
    assert.equal(isTweetContentValid("Short" + footer), false);
    assert.equal(isTweetContentValid("Hello #SPX gamma" + footer), false);
    assert.equal(isTweetContentValid("@there check this" + footer), false);
  });

  it("accepts real data-backed copy", () => {
    assert.equal(
      isTweetContentValid(
        "SPX $6312 in negative gamma below the $6318 flip. Dealers sell into weakness here — what's your read?" +
          footer,
      ),
      true,
    );
  });
});
