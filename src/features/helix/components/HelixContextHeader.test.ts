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

/**
 * REGRESSION: `pcr` must be the PUT/CALL PREMIUM RATIO (putPremium / callPremium), the ONE
 * definition every other reader of "PCR" in this codebase uses — `unusual-whales.ts`'s dark-pool
 * `pcr` (`callPrem > 0 ? putPrem / callPrem : null`), `spx-desk-brief.ts` (`pcr > 1.1` bearish /
 * `< 0.9` bullish — thresholds that only make sense around a ratio of 1.0), and
 * `MeridianEarningsIntelPanel.tsx`'s `P/C ${pcr.toFixed(2)}`.
 *
 * Before this fix, `HelixContextHeader`'s own `pcr` was computed inline in the component as
 * `putPremium / (callPremium + putPremium)` — PUT PREMIUM'S SHARE OF TOTAL premium, a bounded
 * 0-100% quantity, rendered under the exact same "PCR" label. A perfectly even $100k call / $100k
 * put split rendered "PCR 50%" (the old formula) where every other PCR reader on this product
 * would call that a ratio of 1.00 (even) — the two readers disagree about what PCR means for the
 * SAME tape, the one-field-many-readers failure this lane's own `helix-direction-read.ts` and
 * `helix-flow-aggression.ts` headers were written to stop happening again.
 */
test("REGRESSION: pcr is the put/call PREMIUM RATIO, not put premium's share of total", () => {
  // Even split: the old (buggy) formula reads 50_000/(50_000+50_000) = 0.5 -> "PCR 50%".
  // The correct put/call ratio for an even split is 1.0.
  const even = summarizeHelixTapeContext(
    [alert({ option_type: "CALL", premium: 50_000 }), alert({ option_type: "PUT", premium: 50_000 })],
    "AAPL"
  );
  assert.ok(even);
  assert.equal(even!.pcr, 1);

  // 2x more put premium than call premium: true PCR is 2.0 (bearish by spx-desk-brief.ts's own
  // >1.1 threshold). The old share-of-total formula would have read 200_000/300_000 = 0.667.
  const putHeavy = summarizeHelixTapeContext(
    [alert({ option_type: "CALL", premium: 100_000 }), alert({ option_type: "PUT", premium: 200_000 })],
    "AAPL"
  );
  assert.ok(putHeavy);
  assert.equal(putHeavy!.pcr, 2);

  // No call premium at all: dividing by zero calls is undefined, same as unusual-whales.ts's own
  // `callPrem > 0 ? ... : null` guard — never a fabricated ratio.
  const noCalls = summarizeHelixTapeContext([alert({ option_type: "PUT", premium: 10_000 })], "AAPL");
  assert.ok(noCalls);
  assert.equal(noCalls!.pcr, null);
});
