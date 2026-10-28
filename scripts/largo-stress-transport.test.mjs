import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isRetryableFetchError } from "./audit/lib/fetch-retry.mjs";

describe("fetch-retry transport classification", () => {
  it("treats ECONNRESET as retryable", () => {
    const err = new TypeError("fetch failed", { cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }) });
    assert.equal(isRetryableFetchError(err), true);
  });
});
