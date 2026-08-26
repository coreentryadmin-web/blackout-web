import { test } from "node:test";
import assert from "node:assert/strict";
import {
  summarizeSessionFlowBias,
  darkPoolNearReference,
  derivePlayPlatformContext,
  platformConvictionDelta,
  platformStarredLine,
  largestAlignedFlowPremium,
} from "./vector-play-platform";

test("summarizeSessionFlowBias: premium-weighted lean ignores sub-floor prints", () => {
  const r = summarizeSessionFlowBias([
    { option_type: "CALL", premium: 100_000 },
    { option_type: "CALL", premium: 800_000 },
    { option_type: "PUT", premium: 300_000 },
  ]);
  assert.ok(r);
  assert.equal(r!.bias, "bull");
});

test("platformConvictionDelta: aligned flow boosts long, opposing flow docks short", () => {
  const ctx = derivePlayPlatformContext(
    {
      sessionFlows: [
        { option_type: "CALL", premium: 2_000_000 },
        { option_type: "PUT", premium: 400_000 },
      ],
      darkPoolLevels: [{ strike: 180, premium: 1e6, pct: 35 }],
    },
    "long",
    180,
    180
  );
  assert.ok(ctx);
  assert.ok(platformConvictionDelta(ctx, "long") > platformConvictionDelta(ctx, "short"));
});

test("platformStarredLine: cites flow and dark pool when present", () => {
  const ctx = derivePlayPlatformContext(
    {
      sessionFlows: [{ option_type: "PUT", premium: 1_200_000 }],
      darkPoolLevels: [{ strike: 7500, premium: 1e6, pct: 28 }],
    },
    "short",
    7500,
    7560
  );
  const line = platformStarredLine(ctx);
  assert.ok(line);
  assert.match(line!, /HELIX flow bear/);
});
