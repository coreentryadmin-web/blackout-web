import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { flowsMemberCacheKey, FLOWS_WARM_LIMITS } from "@/lib/flows-member-cache-key";

describe("flowsMemberCacheKey", () => {
  it("matches the HELIX flows route head-page key shape", () => {
    assert.equal(
      flowsMemberCacheKey({ pageLimit: 30 }),
      "flows:pg:168:0:all:any:30"
    );
    assert.equal(
      flowsMemberCacheKey({ pageLimit: 500, min_premium: 200_000 }),
      "flows:pg:168:200000:all:any:500"
    );
  });

  it("warm limits cover site-latency probe and desk default", () => {
    assert.deepEqual(FLOWS_WARM_LIMITS, [30, 500]);
  });
});
