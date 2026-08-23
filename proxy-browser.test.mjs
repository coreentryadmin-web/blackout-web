/**
 * Tests the pure `mobileUaWarning` guard: proxy-browser.cjs must warn when a desktop-width
 * viewport is requested without --desktop, since that combination silently renders with the
 * mobile UA (BlackOutiOSApp/1.0) and previously produced a false P0 in a live UI audit
 * (docs/audit/UI-UX-MAP.md's top-of-file correction, 2026-08-23). No browser/network needed.
 * Run: `node --test proxy-browser.test.mjs`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mobileUaWarning } from "./proxy-browser.cjs";

test("warns on a desktop-width viewport without --desktop", () => {
  assert.ok(mobileUaWarning("1440x900", false));
});

test("does not warn when --desktop is passed", () => {
  assert.equal(mobileUaWarning("1440x900", true), null);
});

test("does not warn on the mobile default viewport", () => {
  assert.equal(mobileUaWarning("430x932", false), null);
});

test("warns at the 1024px threshold, not below it", () => {
  assert.ok(mobileUaWarning("1024x768", false));
  assert.equal(mobileUaWarning("1023x768", false), null);
});

test("does not throw on a malformed viewport string", () => {
  assert.equal(mobileUaWarning("not-a-viewport", false), null);
});
