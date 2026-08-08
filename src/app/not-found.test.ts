import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { metadata } from "./not-found.tsx";

// Regression guard: the 404 page previously had no explicit noindex, relying solely on
// Next.js's automatic HTTP 404 status. next.config.mjs documents a real prior incident where
// a Cloudflare edge-cache rule served a cached response with the wrong state to the wrong
// users — defense-in-depth here means not relying on status code alone.

describe("not-found metadata", () => {
  it("explicitly noindexes the 404 page", () => {
    assert.deepEqual(metadata.robots, { index: false, follow: false });
  });
});
