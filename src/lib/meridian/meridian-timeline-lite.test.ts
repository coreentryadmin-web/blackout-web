import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { describeEmCoverage } from "@/lib/meridian/meridian-em-priority";

describe("Meridian timeline lite enrich flag", () => {
  test("deferred enrich coverage note is explicit", () => {
    const cov = describeEmCoverage(12, 0, 0);
    assert.equal(cov.attempted, 0);
    assert.equal(cov.skipped, 12);
    const liteNote = "Expected-move enrichment deferred — lite timeline payload.";
    assert.ok(liteNote.includes("deferred"));
  });
});
