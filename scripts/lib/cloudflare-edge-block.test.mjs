import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isCloudflareEdgeBlock, EXIT_EDGE_BLOCKED } from "./cloudflare-edge-block.mjs";

describe("isCloudflareEdgeBlock", () => {
  it("detects Cloudflare block page on 403", () => {
    const html = "<html><h1>Sorry, you have been blocked</h1><div id=\"cf-error-details\"></div>";
    assert.equal(isCloudflareEdgeBlock(403, html), true);
  });

  it("does not treat app JSON 403 as edge block", () => {
    assert.equal(isCloudflareEdgeBlock(403, '{"error":"forbidden"}'), false);
  });

  it("does not treat missing chunk 404 HTML as edge block", () => {
    assert.equal(isCloudflareEdgeBlock(404, "<html>Not Found</html>"), false);
  });

  it("exports EXIT_EDGE_BLOCKED", () => {
    assert.equal(EXIT_EDGE_BLOCKED, 2);
  });
});
