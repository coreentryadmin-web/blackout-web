import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeMeridianVectorRegime,
  shapeMeridianVectorDeskRead,
} from "./meridian-vector-for-earnings-core";

test("describeMeridianVectorRegime maps posture to desk copy", () => {
  assert.equal(describeMeridianVectorRegime("long"), "Long gamma · mean-revert");
  assert.equal(describeMeridianVectorRegime("short"), "Short gamma · momentum");
  assert.equal(describeMeridianVectorRegime("transition"), "At gamma flip");
  assert.equal(describeMeridianVectorRegime("unknown"), null);
});

test("shapeMeridianVectorDeskRead: structure + beads + flow when Vector state is live", () => {
  const read = shapeMeridianVectorDeskRead({
    horizon: "weekly",
    spot: 210,
    expiry: "2026-08-29",
    move_pct: 6.2,
    bands: null,
    regime: "long",
    gexWalls: {
      callWalls: [{ strike: 215, pct: 12 }],
      putWalls: [{ strike: 205, pct: 10 }],
    },
    gammaFlip: 208,
    maxPain: 212,
    wallHistory: [
      {
        time: 1,
        walls: { callWalls: [], putWalls: [] },
      },
    ],
    wallEvents: [
      {
        time: Date.parse("2026-08-25T14:30:00-04:00"),
        lens: "gex",
        kind: "call_wall_building",
        message: "Call wall 215 building — 8% → 12% gamma",
        severity: "info",
      },
    ],
    flowMarkers: {
      available: true,
      expiry: "2026-08-29",
      spot: 210,
      prints: [
        {
          strike: 212,
          side: "call",
          premium: 420_000,
          size: 200,
          tsMs: Date.parse("2026-08-25T15:00:00-04:00"),
        },
      ],
      meta: {
        minPremium: 25_000,
        largeFound: 1,
        truncated: 0,
        partial: false,
        deadlineHit: false,
      },
    },
    freshness_note: "Snapshot is 4 minutes old.",
  });

  assert.equal(read.available, true);
  assert.equal(read.regime, "Long gamma · mean-revert");
  assert.equal(read.call_wall, 215);
  assert.equal(read.put_wall, 205);
  assert.equal(read.bead_samples, 1);
  assert.equal(read.recent_events.length, 1);
  assert.match(read.recent_events[0]!.message, /building/);
  assert.equal(read.recent_flow.length, 1);
  assert.match(read.recent_flow[0]!.premium_label, /\$/);
});

test("shapeMeridianVectorDeskRead: honest empty when no Vector surface", () => {
  const read = shapeMeridianVectorDeskRead({
    horizon: "weekly",
    spot: null,
    expiry: null,
    move_pct: null,
    bands: null,
    regime: null,
    gexWalls: null,
    gammaFlip: null,
    maxPain: null,
    wallHistory: [],
    wallEvents: [],
    flowMarkers: null,
    freshness_note: null,
  });
  assert.equal(read.available, false);
  assert.deepEqual(read.recent_events, []);
  assert.deepEqual(read.recent_flow, []);
});
