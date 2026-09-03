import assert from "node:assert/strict";
import { test } from "node:test";
import { deskConvergenceLaneFreshness } from "@/lib/largo/spx-desk-convergence-lane-freshness";

const NOW = Date.UTC(2026, 8, 21, 14, 0, 0);

test("deskConvergenceLaneFreshness maps merged desk bundle to pulse/desk/flow layers", () => {
  const fresh = deskConvergenceLaneFreshness(
    {
      desk: { polled_at: new Date(NOW - 1_000).toISOString() } as never,
      flow: { polled_at: new Date(NOW - 1_500).toISOString() } as never,
      pulse: { polled_at: new Date(NOW - 800).toISOString() } as never,
      merged: { market_open: true, polled_at: new Date(NOW - 1_000).toISOString(), feed_stalled: false } as never,
    },
    NOW
  );
  assert.equal(fresh.length, 3);
  assert.deepEqual(
    fresh.map((l) => l.lane),
    ["pulse", "desk", "flow"]
  );
  assert.equal(fresh[0]?.status, "live");
});
