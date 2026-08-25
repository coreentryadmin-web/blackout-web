import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseSavedEarningsTab,
  parseSavedFilter,
} from "@/features/meridian/lib/meridian-desk-prefs-core";

describe("meridian-desk-prefs-core", () => {
  it("accepts valid earnings tabs and rejects unknown values", () => {
    assert.equal(parseSavedEarningsTab("positioning"), "positioning");
    assert.equal(parseSavedEarningsTab("POSITIONING"), "positioning");
    assert.equal(parseSavedEarningsTab("hacked"), null);
    assert.equal(parseSavedEarningsTab(""), null);
  });

  it("accepts valid lane filters and rejects unknown values", () => {
    assert.equal(parseSavedFilter("mega_cap"), "mega_cap");
    assert.equal(parseSavedFilter("earnings"), "earnings");
    assert.equal(parseSavedFilter("all"), "all");
    assert.equal(parseSavedFilter("imp4"), null);
  });
});
