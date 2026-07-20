import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { deterministicLargoFollowups } from "@/lib/largo/largo-followups";

describe("deterministicLargoFollowups", () => {
  test("returns three distinct chips for SPX desk questions", () => {
    const chips = deterministicLargoFollowups("what's the SPX setup right now");
    assert.equal(chips.length, 3);
    assert.ok(chips.every((c) => c.length > 5));
    assert.equal(new Set(chips.map((c) => c.toLowerCase())).size, 3);
  });

  test("uses BIE router followups when intent matches", () => {
    const chips = deterministicLargoFollowups("full platform snapshot");
    assert.equal(chips.length, 3);
    assert.ok(chips.some((c) => /SPX|Thermal|0DTE/i.test(c)));
  });

  test("personalizes ticker hint", () => {
    const chips = deterministicLargoFollowups("what's going on", "NVDA");
    assert.ok(chips.some((c) => c.includes("NVDA")));
  });
});
