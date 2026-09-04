import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { formatScanFreshnessEt } from "./swing-cockpit-utils.ts";

describe("formatScanFreshnessEt", () => {
  test("formats ISO to ET clock", () => {
    const label = formatScanFreshnessEt("2026-09-04T18:30:00.000Z");
    assert.match(label, /ET$/);
    assert.notEqual(label, "—");
  });

  test("null/invalid → em dash", () => {
    assert.equal(formatScanFreshnessEt(null), "—");
    assert.equal(formatScanFreshnessEt("not-a-date"), "—");
  });
});
