import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldRefreshOnRthTransition } from "@/features/helix/lib/helix-flow-brief-refresh";

test("shouldRefreshOnRthTransition: fires exactly on the closed -> open transition", () => {
  assert.equal(
    shouldRefreshOnRthTransition(false, true),
    true,
    "market just opened — must force an immediate refresh so the brief isn't missing/stale at 9:30 ET"
  );
});

test("shouldRefreshOnRthTransition: does NOT fire while already open (steady state)", () => {
  assert.equal(
    shouldRefreshOnRthTransition(true, true),
    false,
    "already open on both ticks — the normal 15-min refresh() interval owns this, not the 60s poller"
  );
});

test("shouldRefreshOnRthTransition: does NOT fire while already closed", () => {
  assert.equal(shouldRefreshOnRthTransition(false, false), false);
});

test("shouldRefreshOnRthTransition: does NOT fire on the open -> closed transition", () => {
  // Closing is handled by the existing plain `setMarketOpen(false)` path — the component
  // deliberately preserves the last RTH brief text across the 4 PM boundary rather than
  // re-fetching or clearing it, so this direction must stay a no-op.
  assert.equal(shouldRefreshOnRthTransition(true, false), false);
});
