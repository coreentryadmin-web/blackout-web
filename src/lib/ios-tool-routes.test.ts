import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getIosToolMeta,
  getIosToolNavLabel,
  isIosNativeShellRoute,
  isIosToolRoute,
  IOS_TOOLS,
} from "@/lib/ios-tool-routes";

describe("isIosToolRoute", () => {
  it("matches primary tool paths", () => {
    assert.equal(isIosToolRoute("/dashboard"), true);
    assert.equal(isIosToolRoute("/flows"), true);
    assert.equal(isIosToolRoute("/heatmap"), true);
    assert.equal(isIosToolRoute("/terminal"), true);
    assert.equal(isIosToolRoute("/nighthawk/edition"), true);
    assert.equal(isIosToolRoute("/grid"), true);
  });

  it("rejects marketing and auth paths", () => {
    assert.equal(isIosToolRoute("/"), false);
    assert.equal(isIosToolRoute("/pricing"), false);
    assert.equal(isIosToolRoute("/sign-in"), false);
    assert.equal(isIosToolRoute("/faq"), false);
  });

  it("resolves nav labels for tool routes", () => {
    assert.equal(getIosToolNavLabel("/dashboard"), "SPX Slayer");
    assert.equal(getIosToolNavLabel("/flows"), "HELIX");
    assert.equal(getIosToolNavLabel("/nighthawk/edition"), "Night Hawk");
    assert.equal(getIosToolNavLabel("/account"), null);
  });
});

describe("isIosNativeShellRoute", () => {
  it("includes tool routes and signed-in utility paths", () => {
    assert.equal(isIosNativeShellRoute("/dashboard"), true);
    assert.equal(isIosNativeShellRoute("/account"), true);
    assert.equal(isIosNativeShellRoute("/upgrade"), true);
    assert.equal(isIosNativeShellRoute("/admin/health"), true);
  });

  it("excludes marketing and auth paths", () => {
    assert.equal(isIosNativeShellRoute("/"), false);
    assert.equal(isIosNativeShellRoute("/sign-in"), false);
    assert.equal(isIosNativeShellRoute("/pricing"), false);
  });
});

describe("IOS_TOOLS metadata", () => {
  it("defines six primary tools with accents", () => {
    assert.equal(IOS_TOOLS.length, 6);
    assert.ok(IOS_TOOLS.every((t) => t.accent.startsWith("#")));
  });

  it("resolves tool meta by path prefix", () => {
    assert.equal(getIosToolMeta("/flows")?.label, "HELIX");
    assert.equal(getIosToolMeta("/nighthawk/edition")?.short, "Hawk");
    assert.equal(getIosToolMeta("/pricing"), null);
  });
});
