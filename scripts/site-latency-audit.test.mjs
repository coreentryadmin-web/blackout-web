import assert from "node:assert/strict";
import test from "node:test";

// Mirrors scripts/site-latency-audit.mjs dashboard ready — must not close over Node globals
// when Playwright serializes the predicate into the browser (Sentry OFF_HOURS ReferenceError).
const dashboardReady = (minRows) =>
  document.querySelectorAll(".spx-gex-matrix-table tbody tr").length >= minRows ||
  document.body.innerText.length > 800;

test("dashboard ready predicate serializes without Node-only OFF_HOURS closure", () => {
  const src = dashboardReady.toString();
  assert.equal(src.includes("OFF_HOURS"), false);
  assert.match(src, /minRows/);
});
