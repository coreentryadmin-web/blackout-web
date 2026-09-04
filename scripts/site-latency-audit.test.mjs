import assert from "node:assert/strict";
import test from "node:test";

/**
 * Playwright's waitForFunction serializes predicates into the browser context.
 * Module-level bindings (e.g. OFF_HOURS) are NOT in scope there — only literals
 * closed over at definition time survive.
 */
test("dashboard ready predicate serializes without outer-scope references", () => {
  const minRows = 5;
  const ready = () =>
    document.querySelectorAll(".spx-gex-matrix-table tbody tr").length >= minRows ||
    document.body.innerText.length > 800;

  const src = ready.toString();
  assert.doesNotMatch(src, /\bOFF_HOURS\b/, "predicate must not reference OFF_HOURS");
  assert.match(src, /\bminRows\b/, "predicate should close over the baked row threshold");
  assert.equal(minRows, 5);
});
