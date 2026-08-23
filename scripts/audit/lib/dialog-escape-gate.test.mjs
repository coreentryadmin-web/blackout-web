import test from "node:test";
import assert from "node:assert/strict";
import { shouldCheckEscape } from "./dialog-escape-gate.mjs";

const at = (url, dialogs) => ({ url, dialogs });

test("a dialog opening on the SAME page is checked — the real trap case", () => {
  assert.equal(shouldCheckEscape(at("/dashboard", 0), at("/dashboard", 1)), true);
});

test("a NAVIGATION is never checked, however many dialogs the destination ships", () => {
  // The measured production case: /dashboard -> /faq, destination carries 2 as static furniture.
  assert.equal(shouldCheckEscape(at("/dashboard", 0), at("/faq", 2)), false);
  assert.equal(shouldCheckEscape(at("/dashboard", 0), at("/pricing", 2)), false);
  assert.equal(shouldCheckEscape(at("/dashboard", 0), at("/learn", 2)), false);
  assert.equal(shouldCheckEscape(at("/dashboard", 0), at("/", 2)), false);
});

test("a query-string change counts as a navigation too", () => {
  assert.equal(shouldCheckEscape(at("/dashboard", 0), at("/dashboard?tab=intel", 3)), false);
});

test("no new dialog on the same page is not checked", () => {
  assert.equal(shouldCheckEscape(at("/dashboard", 2), at("/dashboard", 2)), false);
  assert.equal(shouldCheckEscape(at("/dashboard", 2), at("/dashboard", 1)), false);
});

test("a null fingerprint is not a pass — an unmeasured click is never a clean one", () => {
  assert.equal(shouldCheckEscape(null, at("/dashboard", 1)), false);
  assert.equal(shouldCheckEscape(at("/dashboard", 0), null), false);
});
