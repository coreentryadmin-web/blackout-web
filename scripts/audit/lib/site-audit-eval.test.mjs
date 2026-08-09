import test from "node:test";
import assert from "node:assert/strict";
import { isStreamingUrl, isSoftNotFound, hasServerError, toInternalPath, canonicalPath } from "./site-audit-eval.mjs";

const BASE = "https://blackouttrades.com";

test("streaming endpoints are recognised so a render audit can abort them", () => {
  for (const u of [
    "https://blackouttrades.com/api/market/zerodte/marks/stream",
    "https://blackouttrades.com/api/market/flows/stream",
    "https://blackouttrades.com/api/x/events?since=1",
  ]) assert.equal(isStreamingUrl(u), true, u);
  // Must NOT swallow ordinary endpoints — aborting a real API call would make
  // a working page look broken, the opposite of the bug this guards.
  for (const u of [
    "https://blackouttrades.com/api/market/gex-heatmap?ticker=SPX",
    "https://blackouttrades.com/api/market/zerodte/board",
    "https://blackouttrades.com/streams-explained",
  ]) assert.equal(isStreamingUrl(u), false, u);
});

test("a 200 carrying the not-found page is reported as a soft 404", () => {
  assert.equal(isSoftNotFound(200, "<h1>This page could not be found.</h1>"), true);
  assert.equal(isSoftNotFound(200, "<title>404 — BlackOut</title>"), true);
  assert.equal(isSoftNotFound(404, "<h1>This page could not be found.</h1>"), false, "a real 404 is not a SOFT 404");
  assert.equal(isSoftNotFound(200, "<p>Our 404 page is styled</p>"), false, "prose mentioning 404 is not a soft 404");
});

test("server-error pages are detected from the body", () => {
  assert.equal(hasServerError("Application error: a client-side exception has occurred"), true);
  assert.equal(hasServerError("<title>500 Internal</title>"), true);
  assert.equal(hasServerError("<p>All systems normal</p>"), false);
});

test("hrefs are entity-decoded before comparison", () => {
  // The bug this exists for: served HTML escapes &, so the literal string is
  // not the URL. Treating it literally produced 52 phantom /pricing variants.
  assert.equal(
    toInternalPath("/pricing?utm_source=learn&amp;utm_medium=referral", BASE),
    "/pricing?utm_source=learn&utm_medium=referral"
  );
  assert.equal(toInternalPath("https://blackouttrades.com/vector", BASE), "/vector");
  assert.equal(toInternalPath("https://example.com/x", BASE), null, "off-origin");
  assert.equal(toInternalPath("#top", BASE), null);
  assert.equal(toInternalPath("mailto:a@b.com", BASE), null);
  assert.equal(toInternalPath("javascript:void(0)", BASE), null);
  assert.equal(toInternalPath(null, BASE), null);
});

test("tracking params collapse so one page is not crawled 52 times", () => {
  assert.equal(canonicalPath("/pricing?utm_source=learn&utm_medium=referral"), "/pricing");
  assert.equal(canonicalPath("/pricing?gclid=abc"), "/pricing");
  assert.equal(canonicalPath("/learn/x#section"), "/learn/x");
  // Real query params must survive — collapsing them would hide genuinely
  // different pages behind one entry.
  assert.equal(canonicalPath("/heatmap?ticker=SPX"), "/heatmap?ticker=SPX");
  assert.equal(canonicalPath("/heatmap?ticker=SPX&utm_source=x"), "/heatmap?ticker=SPX");
});
