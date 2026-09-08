import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DESK_TIER_REQUIREMENTS } from "./desk-tier-requirements";
import { TOOLS } from "./tool-access";

/**
 * `DESK_TIER_REQUIREMENTS` is the single source of truth the pricing comparison table
 * (`FeatureComparison`) uses to decide whether SPX Slayer ($49, "community" tier) or Premium
 * ($199, "premium" tier) shows a checkmark for each desk. A hand-typed manifest that silently
 * drifts from what a desk's own `layout.tsx` actually enforces would recreate exactly the bug
 * this file exists to prevent — the pricing page would advertise access a plan doesn't grant, or
 * hide access a plan does grant.
 *
 * This scans each desk's real `layout.tsx` for its `requireDeskTool(minTier, ...)` /
 * `requireTier(minTier)` call and asserts the literal matches the manifest — same defensive
 * source-scan pattern `desk-protected-route-coverage.test.ts` already uses for the
 * protected-route lists, applied here to the pricing-tier gate instead of the auth gate.
 */

const TIER_CALL_RE = /require(?:DeskTool|Tier)\(\s*"(free|community|premium)"/;

describe("DESK_TIER_REQUIREMENTS matches each desk's real layout.tsx gate", () => {
  for (const tool of TOOLS) {
    it(`${tool.key} (${tool.href}) requires the tier its layout.tsx actually enforces`, () => {
      const layoutPath = join("src", "app", "(site)", tool.href.replace(/^\//, ""), "layout.tsx");
      const src = readFileSync(layoutPath, "utf8");
      const match = src.match(TIER_CALL_RE);
      assert.ok(
        match,
        `${layoutPath} has no requireDeskTool/requireTier("free"|"community"|"premium") call — ` +
          `DESK_TIER_REQUIREMENTS cannot be verified against it`
      );
      assert.equal(
        DESK_TIER_REQUIREMENTS[tool.key],
        match![1],
        `DESK_TIER_REQUIREMENTS["${tool.key}"] is "${DESK_TIER_REQUIREMENTS[tool.key]}" but ` +
          `${layoutPath} actually gates at "${match![1]}"`
      );
    });
  }

  it("every ToolKey in TOOLS has a DESK_TIER_REQUIREMENTS entry", () => {
    for (const tool of TOOLS) {
      assert.ok(
        tool.key in DESK_TIER_REQUIREMENTS,
        `DESK_TIER_REQUIREMENTS is missing an entry for "${tool.key}"`
      );
    }
  });
});
