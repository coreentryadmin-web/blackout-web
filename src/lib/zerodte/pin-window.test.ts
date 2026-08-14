import test from "node:test";
import assert from "node:assert/strict";
import { pinWindowStatus } from "./pin-window.ts";

// pinWindowStatus exists so a caller can tell an EXPECTED off-hours zero from a lane that ran and
// found nothing — discoverPinSetups returns a bare [] for both. Reporting the 8am zero as a market
// read would fabricate a "no pins qualified" verdict nobody measured.

const at = (h: number, m = 0) => h * 60 + m;

test("pinWindowStatus is open across the directional PIN window", () => {
  assert.equal(pinWindowStatus(at(9, 30)), "open", "inclusive at the open");
  assert.equal(pinWindowStatus(at(12)), "open");
  assert.equal(pinWindowStatus(at(15, 29)), "open", "last minute inside the window");
});

test("pinWindowStatus is off_hours before the open and at/after the cutoff", () => {
  assert.equal(pinWindowStatus(at(4)), "off_hours");
  assert.equal(pinWindowStatus(at(9, 29)), "off_hours", "one minute early is still closed");
  assert.equal(pinWindowStatus(at(15, 30)), "off_hours", "cutoff is exclusive");
  assert.equal(pinWindowStatus(at(20)), "off_hours");
});
