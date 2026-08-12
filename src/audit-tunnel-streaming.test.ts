import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const { isStreamingRequest } = require_("../scripts/audit/lib/proxy-tunnel-context.cjs") as {
  isStreamingRequest: (req: { url: () => string; headers: () => Record<string, string> }) => boolean;
};

/**
 * Which requests are LONG-LIVED decides two things in the tunnel: the deadline they get, and
 * whether hitting it is reported as a failure. Both were wrong for the desk's live-price endpoint.
 *
 * The old test was `/(stream|sse|events)(\?|$)` — a REQUIRED leading slash. `spot-stream` has a
 * hyphen there, so an SSE endpoint got the short timeout and then printed as
 * `FAIL … /api/market/stocks/spot-stream: timeout` on every otherwise-healthy sweep.
 */
const req = (url: string, headers: Record<string, string> = {}) => ({ url: () => url, headers: () => headers });

test("a hyphenated stream endpoint is recognised — the case that was misreported as a failure", () => {
  assert.equal(isStreamingRequest(req("https://x.test/api/market/stocks/spot-stream?tickers=ACHR,BW")), true);
});

test("a slash-delimited stream endpoint still is", () => {
  assert.equal(isStreamingRequest(req("https://x.test/api/market/zerodte/marks/stream")), true);
  assert.equal(isStreamingRequest(req("https://x.test/api/events")), true);
  assert.equal(isStreamingRequest(req("https://x.test/api/sse?room=1")), true);
});

test("the Accept header alone is enough, whatever the path looks like", () => {
  assert.equal(isStreamingRequest(req("https://x.test/api/anything", { accept: "text/event-stream" })), true);
});

test("an ordinary endpoint is NOT long-lived — a timeout there is a real failure and must stay loud", () => {
  assert.equal(isStreamingRequest(req("https://x.test/api/market/zerodte/board")), false);
  assert.equal(isStreamingRequest(req("https://x.test/api/market/gex-heatmap?ticker=SPX")), false);
  assert.equal(isStreamingRequest(req("https://x.test/nighthawk")), false);
});

test("a word merely CONTAINING 'stream' is not a stream", () => {
  // "streaming-service" / "mainstream" must not buy a 3-minute deadline and failure amnesty.
  assert.equal(isStreamingRequest(req("https://x.test/api/mainstream")), false);
  assert.equal(isStreamingRequest(req("https://x.test/api/streamlined-quotes")), false);
});
