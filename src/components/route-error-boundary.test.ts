/**
 * Regression guard: `error.tsx` must be a client component (Next.js App Router requirement for
 * error boundaries), so it can't export static `metadata.title` the way `not-found.tsx` does —
 * the browser tab kept whatever title the page had right before it crashed, never reflecting the
 * error state. `setErrorPageTitle` is the extracted, directly-testable fix (an injectable `doc`
 * stands in for a real DOM document, since this repo carries no React Testing Library).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ERROR_PAGE_TITLE, setErrorPageTitle } from "./route-error-boundary.tsx";

describe("setErrorPageTitle", () => {
  it("overwrites the tab title with the error-page title", () => {
    const doc = { title: "Some Stale Page Title — BlackOut Trades" };
    setErrorPageTitle(doc);
    assert.equal(doc.title, ERROR_PAGE_TITLE);
  });

  it("overwrites regardless of what the prior title was", () => {
    const doc = { title: "" };
    setErrorPageTitle(doc);
    assert.equal(doc.title, ERROR_PAGE_TITLE);
  });
});
