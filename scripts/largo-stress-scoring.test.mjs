import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { liveResponseShouldRetry, liveTransportVerdict } from "./largo-stress-scoring.mjs";

describe("liveTransportVerdict", () => {
  it("marks ECONNRESET transport as SKIP", () => {
    const v = liveTransportVerdict({ status: 0, transport_error: "ECONNRESET" });
    assert.equal(v.verdict, "SKIP");
    assert.match(v.issues[0], /transport-ECONNRESET/);
  });

  it("marks 429 throttled as SKIP", () => {
    const v = liveTransportVerdict({ status: 429, throttled: true });
    assert.equal(v.verdict, "SKIP");
    assert.match(v.issues[0], /http-429/);
  });

  it("returns null for HTTP 200", () => {
    assert.equal(liveTransportVerdict({ status: 200 }), null);
  });
});

describe("liveResponseShouldRetry", () => {
  it("retries on 429 and transport_error", () => {
    assert.equal(liveResponseShouldRetry({ status: 429 }), true);
    assert.equal(liveResponseShouldRetry({ status: 0, transport_error: "ECONNRESET" }), true);
    assert.equal(liveResponseShouldRetry({ status: 401 }), false);
  });
});
