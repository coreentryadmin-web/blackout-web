import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pathFromDeepLink } from "./ios-deep-links";

describe("pathFromDeepLink — https allow-listed BlackOut URLs", () => {
  it("returns the path + query for our host", () => {
    assert.equal(
      pathFromDeepLink("https://blackouttrades.com/nighthawk?ed=abc"),
      "/nighthawk?ed=abc"
    );
    assert.equal(
      pathFromDeepLink("https://blackouttrades.com/learn/getting-started"),
      "/learn/getting-started"
    );
  });

  it("accepts subdomains of blackouttrades.com", () => {
    assert.equal(
      pathFromDeepLink("https://staging.blackouttrades.com/dashboard"),
      "/dashboard"
    );
  });

  it("rejects paths NOT in the route allow-list", () => {
    // /admin is intentionally NOT allow-listed — see the ROUTE_ALLOWLIST
    // comment in ios-deep-links.ts: server-side role gate still enforces
    // access, but a push-deep-link surface for it is unnecessary UX noise.
    assert.equal(pathFromDeepLink("https://blackouttrades.com/admin"), null);
    assert.equal(pathFromDeepLink("https://blackouttrades.com/pricing"), null);
    assert.equal(pathFromDeepLink("https://blackouttrades.com/sign-up"), null);
    assert.equal(pathFromDeepLink("https://blackouttrades.com/"), null);
  });

  it("rejects foreign hosts (open-redirect defence)", () => {
    assert.equal(pathFromDeepLink("https://evilblackouttrades.com/dashboard"), null);
    assert.equal(pathFromDeepLink("https://phish.example.com/dashboard"), null);
  });
});

describe("pathFromDeepLink — blackout:// custom scheme", () => {
  it("normalizes hostname + path into a single path", () => {
    // URL parses `blackout://nighthawk/edition` as hostname=nighthawk, path=/edition
    // — we reassemble into /nighthawk/edition.
    assert.equal(
      pathFromDeepLink("blackout://nighthawk/edition?ed=xyz"),
      "/nighthawk/edition?ed=xyz"
    );
    assert.equal(
      pathFromDeepLink("blackout://dashboard"),
      "/dashboard"
    );
  });

  it("rejects custom-scheme URLs to non-allow-listed paths", () => {
    assert.equal(pathFromDeepLink("blackout://sign-in"), null);
    assert.equal(pathFromDeepLink("blackout://random-not-a-route"), null);
  });
});

describe("pathFromDeepLink — hardening", () => {
  it("returns null for garbage input rather than throwing", () => {
    assert.equal(pathFromDeepLink(""), null);
    assert.equal(pathFromDeepLink("not-a-url"), null);
    assert.equal(pathFromDeepLink("http:/broken"), null);
  });

  it("rejects protocols we don't recognise", () => {
    assert.equal(pathFromDeepLink("javascript:alert(1)"), null);
    assert.equal(pathFromDeepLink("ftp://blackouttrades.com/nighthawk"), null);
  });
});
