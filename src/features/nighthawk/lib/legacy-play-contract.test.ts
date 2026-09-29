import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveLegacyPlayOcc } from "./legacy-play-contract";

test("resolveLegacyPlayOcc: parses formatOptionsPlay output to OCC", () => {
  const occ = resolveLegacyPlayOcc("NVDA", "NVDA $500 CALL @ $3.33 — Aug 10");
  assert.ok(occ);
  assert.match(occ!, /^NVDA\d{6}C\d{8}$/);
});

test("resolveLegacyPlayOcc: returns null for unparseable strings", () => {
  assert.equal(resolveLegacyPlayOcc("NVDA", "NVDA — no options data available"), null);
  assert.equal(resolveLegacyPlayOcc("NVDA", null), null);
});

// Regression (Night Hawk Legacy aggressive-improvement mandate, 2026-09-13): resolveLegacyPlayOcc
// used to always anchor its bare "Mon DD" year-inference on real wall-clock now, which is wrong
// for a play resolved long after publish (the Legacy edition calendar strip reopens editions up
// to 14 trading days old — legacy-board-calendar.ts). Threading a reference date through fixes it.
test("resolveLegacyPlayOcc: an explicit reference date anchors year-inference instead of real now", () => {
  const reference = new Date("2026-08-24T12:00:00Z");
  const occ = resolveLegacyPlayOcc("NVDA", "NVDA $180 CALL @ $4.00 — Aug 28", reference);
  assert.ok(occ);
  assert.match(occ!, /^NVDA260828C/, "must encode 2026-08-28, not a year-rolled 2027-08-28");
});

test("legacyOccForSnapshot adds O: prefix for Polygon snapshot fetch", () => {
  const { legacyOccForSnapshot } = require("./legacy-play-contract.ts") as typeof import("./legacy-play-contract");
  assert.equal(legacyOccForSnapshot("MRNA260904C00155000"), "O:MRNA260904C00155000");
  assert.equal(legacyOccForSnapshot("O:MRNA260904C00155000"), "O:MRNA260904C00155000");
});
