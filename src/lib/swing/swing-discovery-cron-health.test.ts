import assert from "node:assert/strict";
import { test } from "node:test";
import { swingServingSnapshotProvesDiscoveryHealthy } from "./swing-discovery-cron-health";
import type { SwingServingSnapshot } from "./serving-lane";

const NOW = Date.parse("2026-10-22T16:30:00.000Z");

function snap(partial: Partial<SwingServingSnapshot> & Pick<SwingServingSnapshot, "asOf" | "sessionDay">): SwingServingSnapshot {
  return {
    dossiers: [],
    plays: [],
    watch: [],
    ...partial,
  };
}

test("swingServingSnapshotProvesDiscoveryHealthy: fresh when asOf is today session within ceiling", () => {
  const res = swingServingSnapshotProvesDiscoveryHealthy({
    snap: snap({
      sessionDay: "2026-10-22",
      asOf: new Date(NOW - 45 * 60_000).toISOString(),
    }),
    sessionDay: "2026-10-22",
    maxAgeMin: 36 * 60,
    nowMs: NOW,
  });
  assert.equal(res.fresh, true);
});

test("swingServingSnapshotProvesDiscoveryHealthy: not fresh when session day mismatches", () => {
  const res = swingServingSnapshotProvesDiscoveryHealthy({
    snap: snap({
      sessionDay: "2026-10-21",
      asOf: new Date(NOW - 5 * 60_000).toISOString(),
    }),
    sessionDay: "2026-10-22",
    maxAgeMin: 36 * 60,
    nowMs: NOW,
  });
  assert.equal(res.fresh, false);
  assert.match(res.detail, /expected 2026-10-22/);
});

test("swingServingSnapshotProvesDiscoveryHealthy: not fresh when asOf exceeds ceiling", () => {
  const res = swingServingSnapshotProvesDiscoveryHealthy({
    snap: snap({
      sessionDay: "2026-10-22",
      asOf: new Date(NOW - 40 * 60 * 60_000).toISOString(),
    }),
    sessionDay: "2026-10-22",
    maxAgeMin: 36 * 60,
    nowMs: NOW,
  });
  assert.equal(res.fresh, false);
});
