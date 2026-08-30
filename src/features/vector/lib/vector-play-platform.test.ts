import { test } from "node:test";
import assert from "node:assert/strict";
import {
  summarizeSessionFlowBias,
  derivePlayPlatformContext,
  platformConvictionDelta,
  platformStarredLine,
} from "./vector-play-platform";

test("summarizeSessionFlowBias: premium-weighted lean ignores sub-floor prints", () => {
  const r = summarizeSessionFlowBias([
    { option_type: "CALL", premium: 100_000, ask_pct: 85 },
    { option_type: "CALL", premium: 800_000, ask_pct: 85 },
    { option_type: "PUT", premium: 300_000, ask_pct: 85 },
  ]);
  assert.ok(r);
  assert.equal(r!.bias, "bull");
});

test("summarizeSessionFlowBias: a SOLD call reads bearish, not bullish, from its option type alone", () => {
  // Regression pin: a call print with ask_pct <= 40 (hit the bid, i.e. sold) must count toward the
  // BEARISH side of the ratio, not the bullish side, even though its option_type is "CALL". Mirrors
  // the same fix already shipped in HELIX (helix-flow-aggression.ts).
  const r = summarizeSessionFlowBias([
    { option_type: "CALL", premium: 900_000, ask_pct: 15 }, // sold call -> bearish
    { option_type: "PUT", premium: 300_000, ask_pct: 15 }, // sold put -> bullish
  ]);
  assert.ok(r);
  assert.equal(r!.bias, "bear", "sold call must weigh bearish, sold put bullish");
  // Display totals still report the literal option-type split (a true fact independent of side).
  assert.equal(r!.callPremium, 900_000);
  assert.equal(r!.putPremium, 300_000);
});

test("summarizeSessionFlowBias: prints with no ask_pct (undetermined direction) are excluded, never guessed", () => {
  const r = summarizeSessionFlowBias([
    { option_type: "CALL", premium: 900_000 }, // no ask_pct -> undetermined
  ]);
  assert.equal(r, null, "an undetermined print must not fabricate a bias");
});

test("platformConvictionDelta: aligned flow boosts long, opposing flow docks short", () => {
  const ctx = derivePlayPlatformContext(
    {
      sessionFlows: [
        { option_type: "CALL", premium: 2_000_000, ask_pct: 85 },
        { option_type: "PUT", premium: 400_000, ask_pct: 85 },
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

test("largestAlignedFlowPremium: a sold call must not confirm a long bias", () => {
  // Regression pin: previously a CALL print of any aggressor confirmed "long" — a whale SELLING a
  // call is not support for buying more calls.
  const soldCall = derivePlayPlatformContext(
    { sessionFlows: [{ option_type: "CALL", premium: 3_000_000, ask_pct: 10 }] },
    "long",
    null,
    100
  );
  assert.equal(soldCall?.flowConfirmPremium ?? 0, 0, "a sold call must not confirm a long bias");
});

test("platformStarredLine: cites flow and dark pool when present", () => {
  const ctx = derivePlayPlatformContext(
    {
      sessionFlows: [{ option_type: "PUT", premium: 1_200_000, ask_pct: 85 }],
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
