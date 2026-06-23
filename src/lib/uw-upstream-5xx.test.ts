import { test } from "node:test";
import assert from "node:assert/strict";
import { isUwUpstream5xx } from "./uw-upstream-5xx";

test("matches 5xx in uwGet message format", () => {
  for (const s of [500, 502, 503, 504, 599]) {
    assert.ok(isUwUpstream5xx(`Unusual Whales /flow/alerts → ${s}`), `${s}`);
  }
});

test("does NOT match 429 (rate-limit must not feed the 5xx branch)", () => {
  assert.equal(isUwUpstream5xx("Unusual Whales /flow/alerts → 429"), false);
  assert.equal(isUwUpstream5xx("Unusual Whales /flow/alerts → 429 circuit"), false);
});

test("does NOT match 403", () => {
  assert.equal(isUwUpstream5xx("Unusual Whales /flow → 403"), false);
});

test("boundary: does NOT match 4-digit 5000", () => {
  assert.equal(isUwUpstream5xx("Unusual Whales /flow → 5000"), false);
});
