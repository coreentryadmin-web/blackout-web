import test from "node:test";
import assert from "node:assert/strict";

import { summarizeHelixTapeContext } from "./HelixContextHeader";
import type { FlowAlert } from "@/lib/api";

/**
 * `FlowAlert.option_type` is a bare `string` (src/lib/api.ts), not a `"CALL" | "PUT"` union — an
 * UNKNOWN/typeless/malformed print is a real, observed case, which is exactly why sibling panels
 * (FlowFeed.tsx's sector-rotation aggregator, NetPremiumLeaderboard.tsx) both carry an explicit
 * "gap-#6: UNKNOWN/typeless prints count toward neither side" rule: `if (CALL) ... else if (PUT)
 * ...`, never a bare `else`.
 *
 * `summarizeHelixTapeContext` (HelixContextHeader.tsx) had the OLD, un-fixed shape instead:
 * `if (PUT) putPremium += prem; else callPremium += prem;` — every non-PUT value, including an
 * empty string, a typo'd type, or a genuinely unknown classification, was silently counted as a
 * CALL. That fabricates call premium out of prints the tape could not classify at all, and
 * inflates both the Call/Put premium readout and the PCR this header renders for the ticker.
 */
function alert(overrides: Partial<FlowAlert>): FlowAlert {
  return {
    ticker: "AAPL",
    premium: 0,
    option_type: "CALL",
    expiry: "2026-12-18",
    strike: 200,
    direction: "",
    score: 0,
    route: "flow",
    alerted_at: "",
    ...overrides,
  };
}

test("REGRESSION: an UNKNOWN option_type is not fabricated into call premium", () => {
  const summary = summarizeHelixTapeContext(
    [
      alert({ option_type: "CALL", premium: 100_000 }),
      alert({ option_type: "PUT", premium: 50_000 }),
      // A real, unclassifiable print — neither CALL nor PUT. Must count toward NEITHER side.
      alert({ option_type: "UNKNOWN", premium: 1_000_000 }),
    ],
    "AAPL"
  );

  assert.ok(summary);
  // Before the fix: callPremium would be 100_000 + 1_000_000 = 1_100_000 (the UNKNOWN print
  // fabricated into a CALL). The correct reading leaves it out of both sides entirely.
  assert.equal(summary!.callPremium, 100_000);
  assert.equal(summary!.putPremium, 50_000);
});

test("REGRESSION: an empty-string option_type is not fabricated into call premium", () => {
  const summary = summarizeHelixTapeContext(
    [alert({ option_type: "", premium: 500_000 }), alert({ option_type: "PUT", premium: 10_000 })],
    "AAPL"
  );

  assert.ok(summary);
  assert.equal(summary!.callPremium, 0);
  assert.equal(summary!.putPremium, 10_000);
});

test("CALL/PUT classification is still case-insensitive and otherwise unaffected", () => {
  const summary = summarizeHelixTapeContext(
    [alert({ option_type: "call", premium: 20_000 }), alert({ option_type: "put", premium: 30_000 })],
    "AAPL"
  );

  assert.ok(summary);
  assert.equal(summary!.callPremium, 20_000);
  assert.equal(summary!.putPremium, 30_000);
});
