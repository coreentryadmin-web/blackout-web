import assert from "node:assert/strict";
import { test } from "node:test";
import { formatAdminSpxTerminalRel } from "./admin-spx-terminal-rel-time";

const NOW = Date.parse("2026-09-04T16:00:00.000Z");

test("formatAdminSpxTerminalRel: future timestamp beyond tolerance reads as skew", () => {
  assert.equal(formatAdminSpxTerminalRel("2026-09-04T16:01:00.000Z", NOW), "skew");
});

test("formatAdminSpxTerminalRel: small future skew within tolerance reads as now", () => {
  assert.equal(formatAdminSpxTerminalRel("2026-09-04T16:00:02.000Z", NOW), "now");
});

test("formatAdminSpxTerminalRel: past timestamps format compactly", () => {
  assert.equal(formatAdminSpxTerminalRel("2026-09-04T15:59:30.000Z", NOW), "30s");
  assert.equal(formatAdminSpxTerminalRel("2026-09-04T15:55:00.000Z", NOW), "5m");
});
