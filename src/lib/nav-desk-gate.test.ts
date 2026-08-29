import { test } from "node:test";
import assert from "node:assert/strict";
import { isSignedInOnDeskPage } from "./nav-desk-gate";

const DESK_HREFS = ["/dashboard", "/flows", "/heatmap", "/terminal", "/nighthawk", "/vector", "/meridian"];

test("isSignedInOnDeskPage: signed-in member on a desk page — hide marketing links", () => {
  assert.equal(isSignedInOnDeskPage(true, "/nighthawk", DESK_HREFS), true);
  assert.equal(isSignedInOnDeskPage(true, "/vector", DESK_HREFS), true);
  assert.equal(isSignedInOnDeskPage(true, "/nighthawk/some-sub-route", DESK_HREFS), true);
});

test("isSignedInOnDeskPage: signed-out visitor on the same URL — never hide (marketing funnel must show)", () => {
  assert.equal(isSignedInOnDeskPage(false, "/nighthawk", DESK_HREFS), false);
});

test("isSignedInOnDeskPage: signed-in member NOT on a desk page (marketing/account pages) — keep marketing links", () => {
  assert.equal(isSignedInOnDeskPage(true, "/", DESK_HREFS), false);
  assert.equal(isSignedInOnDeskPage(true, "/faq", DESK_HREFS), false);
  assert.equal(isSignedInOnDeskPage(true, "/pricing", DESK_HREFS), false);
  assert.equal(isSignedInOnDeskPage(true, "/learn", DESK_HREFS), false);
});
