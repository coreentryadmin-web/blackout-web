import assert from "node:assert/strict";
import test from "node:test";
import {
  isTransientCurlFailure,
  seoVisibilityExitCode,
  seoVisibilityVerdict,
} from "./seo-visibility-verdict.mjs";

test("seoVisibilityVerdict: GREEN when no fails", () => {
  assert.equal(seoVisibilityVerdict([{ name: "robots.txt", status: "PASS" }]), "GREEN");
});

test("seoVisibilityVerdict: AMBER when only auth fails", () => {
  assert.equal(
    seoVisibilityVerdict([
      { name: "robots.txt", status: "PASS" },
      { name: "auth", status: "FAIL", detail: "session JWT missing" },
    ]),
    "AMBER",
  );
});

test("seoVisibilityVerdict: RED when non-auth check fails", () => {
  assert.equal(
    seoVisibilityVerdict([
      { name: "sitemap.xml", status: "FAIL" },
      { name: "auth", status: "FAIL" },
    ]),
    "RED",
  );
});

test("seoVisibilityExitCode: AMBER exits 0, RED exits 1", () => {
  assert.equal(seoVisibilityExitCode([{ name: "auth", status: "FAIL" }]), 0);
  assert.equal(seoVisibilityExitCode([{ name: "sitemap.xml", status: "FAIL" }]), 1);
});

test("isTransientCurlFailure: connection reset and s=0", () => {
  assert.equal(isTransientCurlFailure({ s: 0, err: "Recv failure: Connection reset by peer" }), true);
  assert.equal(isTransientCurlFailure({ s: 200 }), false);
  assert.equal(isTransientCurlFailure({ s: 401 }), false);
});
