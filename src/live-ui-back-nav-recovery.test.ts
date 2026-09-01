import test from "node:test";
import assert from "node:assert/strict";
// Lives in src/ so `scripts/run-tests.mjs` -- which walks src/ only -- actually runs it. Same
// arrangement as src/meridian-audit-console-errors.test.ts, for the same reason.
import { needsBackRecovery } from "../scripts/audit/lib/back-nav-recovery.mjs";

test("a replace-based URL change (history.length unchanged) needs no BACK recovery", () => {
  // Measured live 2026-08-24: Night Hawk's "0DTE" tab uses router.replace(), so the URL changes
  // but no history entry is pushed. Attempting goBack() here landed on the Playwright context's
  // own blank initial page, not anything the app rendered -- a false "page unusable" finding.
  const before = { url: "/nighthawk", historyLength: 2 };
  const after = { url: "/nighthawk?view=zero_dte", historyLength: 2 };
  assert.equal(needsBackRecovery(before, after), false);
});

test("a real navigation that pushes a history entry needs BACK recovery", () => {
  const before = { url: "/vector", historyLength: 3 };
  const after = { url: "/pricing", historyLength: 4 };
  assert.equal(needsBackRecovery(before, after), true);
});

test("no URL change at all needs no recovery, regardless of history length", () => {
  const before = { url: "/heatmap", historyLength: 2 };
  const after = { url: "/heatmap", historyLength: 2 };
  assert.equal(needsBackRecovery(before, after), false);
});

test("a missing fingerprint (page.evaluate failed) never triggers recovery", () => {
  assert.equal(needsBackRecovery(null, { url: "/x", historyLength: 2 }), false);
  assert.equal(needsBackRecovery({ url: "/x", historyLength: 2 }, null), false);
  assert.equal(needsBackRecovery(null, null), false);
});
