import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { truncateOgTitle, OG_MAX_TITLE_LENGTH } from "./og-title.ts";

// Regression guard: /api/og previously bounded `description` (140 chars) but left `title`
// completely unbounded, even though it's a public, directly-fetchable endpoint (?title=...)
// with no other server-side validation. A very long or unbroken-string title had no
// truncation/overflow guard and could overflow the 1200x630 canvas past the bottom branding bar.

describe("truncateOgTitle", () => {
  it("leaves short titles unchanged", () => {
    assert.equal(truncateOgTitle("BlackOut Trades"), "BlackOut Trades");
  });

  it("leaves a title exactly at the max length unchanged", () => {
    const title = "x".repeat(OG_MAX_TITLE_LENGTH);
    assert.equal(truncateOgTitle(title), title);
  });

  it("truncates a title over the max length with an ellipsis", () => {
    const title = "x".repeat(OG_MAX_TITLE_LENGTH + 50);
    const result = truncateOgTitle(title);
    assert.equal(result.length, OG_MAX_TITLE_LENGTH);
    assert.ok(result.endsWith("..."));
  });

  it("handles an unbroken pathological string (no whitespace to break on)", () => {
    const title = "a".repeat(5000);
    const result = truncateOgTitle(title);
    assert.equal(result.length, OG_MAX_TITLE_LENGTH);
  });
});
