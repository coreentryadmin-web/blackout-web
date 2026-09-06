import test from "node:test";
import assert from "node:assert/strict";
import { etClock } from "./PlayTerminal";

test("PlayTerminal etClock: 24h padded ET wall clock for ISO instants", () => {
  assert.equal(etClock("2026-07-25T10:42:00-04:00"), "10:42");
  assert.equal(etClock("2026-08-19T18:30:05Z"), "14:30");
});

test("PlayTerminal etClock: parses Largo C1 asOf stamps via shared et-clock parser", () => {
  assert.equal(etClock("2026-09-05 16:00 ET"), "16:00");
  assert.equal(etClock("2026-01-14 16:00 ET"), "16:00");
});

test("PlayTerminal etClock: null for missing or unparseable input", () => {
  assert.equal(etClock(null), null);
  assert.equal(etClock(""), null);
  assert.equal(etClock("not-a-date"), null);
});
