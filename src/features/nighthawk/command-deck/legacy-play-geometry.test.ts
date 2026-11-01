import assert from "node:assert/strict";
import { test } from "node:test";

import { legacyZoneLabel } from "./legacy-play-geometry.tsx";

// The bug: LegacyManageGeometry's zoneLabel always rendered live-position command language for
// the two extreme progress zones ("below stop — cut the position" / "at/above target — take
// profit") regardless of play status. For a WATCH or SKIP play there is no open position to cut
// or take profit on — the stock merely sits beyond where a hypothetical entry's stop/target band
// would put it. `legacyZoneLabel` is the extracted pure function; it must reword only those two
// extreme branches for WATCH/SKIP, leaving OPEN/HOLD/TRIM/CLOSED and the three middle-zone labels
// unchanged.

test("legacyZoneLabel: progress<=0 uses live-position language for OPEN/HOLD/TRIM/CLOSED", () => {
  assert.equal(legacyZoneLabel(0, "OPEN"), "below stop — cut the position");
  assert.equal(legacyZoneLabel(-0.2, "HOLD"), "below stop — cut the position");
  assert.equal(legacyZoneLabel(0, "TRIM"), "below stop — cut the position");
  assert.equal(legacyZoneLabel(0, "CLOSED"), "below stop — cut the position");
});

test("legacyZoneLabel: progress>=1 uses live-position language for OPEN/HOLD/TRIM/CLOSED", () => {
  assert.equal(legacyZoneLabel(1, "OPEN"), "at/above target — take profit");
  assert.equal(legacyZoneLabel(1.3, "HOLD"), "at/above target — take profit");
  assert.equal(legacyZoneLabel(1, "TRIM"), "at/above target — take profit");
  assert.equal(legacyZoneLabel(1, "CLOSED"), "at/above target — take profit");
});

test("legacyZoneLabel: progress<=0 is reworded (no 'cut the position') for WATCH/SKIP — this is the bug fix", () => {
  const watch = legacyZoneLabel(0, "WATCH");
  const skip = legacyZoneLabel(-0.4, "SKIP");
  assert.equal(watch, "already below stop — would be invalidated");
  assert.equal(skip, "already below stop — would be invalidated");
  assert.ok(!watch!.includes("cut the position"));
  assert.ok(!skip!.includes("cut the position"));
});

test("legacyZoneLabel: progress>=1 is reworded (no 'take profit') for WATCH/SKIP — this is the bug fix", () => {
  const watch = legacyZoneLabel(1, "WATCH");
  const skip = legacyZoneLabel(1.1, "SKIP");
  assert.equal(watch, "already at/above target before entry");
  assert.equal(skip, "already at/above target before entry");
  assert.ok(!watch!.includes("take profit"));
  assert.ok(!skip!.includes("take profit"));
});

test("legacyZoneLabel: the three middle-zone labels are status-independent (untouched by the fix)", () => {
  for (const status of ["OPEN", "HOLD", "TRIM", "CLOSED", "WATCH", "SKIP"] as const) {
    assert.equal(legacyZoneLabel(0.1, status), "near stop — elevated risk");
    assert.equal(legacyZoneLabel(0.5, status), "mid-range — hold per plan");
    assert.equal(legacyZoneLabel(0.85, status), "nearing target — watch for exit");
  }
});

test("legacyZoneLabel: null/undefined progress returns null regardless of status", () => {
  assert.equal(legacyZoneLabel(null, "OPEN"), null);
  assert.equal(legacyZoneLabel(undefined, "WATCH"), null);
});

test("legacyZoneLabel: boundary values 0.3 and 0.7 land in the mid-range bucket (exclusive comparisons preserved)", () => {
  assert.equal(legacyZoneLabel(0.3, "OPEN"), "mid-range — hold per plan");
  assert.equal(legacyZoneLabel(0.7, "OPEN"), "mid-range — hold per plan");
});
