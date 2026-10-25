import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { computeHelixSessionPulse, sessionPulseBullPct } from "./helix-session-pulse.ts";
import type { FlowAlert } from "@/lib/api";

function flow(partial: Partial<FlowAlert> & { premium: number; ticker: string }): FlowAlert {
  return {
    option_type: "CALL",
    alerted_at: new Date().toISOString(),
    ask_pct: 75,
    fill_price: 1,
    open_interest: 0,
    ...partial,
  } as FlowAlert;
}

describe("computeHelixSessionPulse", () => {
  test("aggregates premium, whales, and direction", () => {
    const now = Date.parse("2026-09-01T15:00:00.000Z");
    const pulse = computeHelixSessionPulse(
      [
        flow({ ticker: "SPX", premium: 2_000_000, option_type: "CALL", ask_pct: 80 }),
        flow({ ticker: "SPX", premium: 300_000, option_type: "PUT", ask_pct: 20 }),
        flow({ ticker: "NVDA", premium: 250_000, option_type: "CALL", ask_pct: 70 }),
      ],
      now
    );
    assert.equal(pulse.printCount, 3);
    assert.equal(pulse.whaleCount, 1);
    assert.equal(pulse.netPremium, 2_000_000 + 250_000 - 300_000);
    assert.equal(pulse.directionRead, "bullish");
    assert.equal(pulse.topTicker?.ticker, "SPX");
  });

  test("counts prints in the last 15 minutes only", () => {
    const now = Date.parse("2026-09-01T15:00:00.000Z");
    const pulse = computeHelixSessionPulse(
      [
        flow({
          ticker: "SPY",
          premium: 500_000,
          alerted_at: new Date(now - 5 * 60_000).toISOString(),
        }),
        flow({
          ticker: "SPY",
          premium: 500_000,
          alerted_at: new Date(now - 20 * 60_000).toISOString(),
        }),
      ],
      now
    );
    assert.equal(pulse.printsLast15m, 1);
  });

  // BUG FIX (2026-09-03): a print stamped in the future (UW clock skew / bad alerted_at) used
  // to produce a NEGATIVE `nowMs - t`, which trivially passed the old unguarded `<= 15min` check
  // and inflated printsLast15m with unverifiable prints. signalWindowAgeMs now rejects anything
  // more than 60s ahead of `now`.
  test("a print stamped well in the future is NOT counted in printsLast15m", () => {
    const now = Date.parse("2026-09-01T15:00:00.000Z");
    const pulse = computeHelixSessionPulse(
      [
        flow({
          ticker: "SPY",
          premium: 500_000,
          alerted_at: new Date(now - 5 * 60_000).toISOString(),
        }),
        flow({
          ticker: "SPY",
          premium: 500_000,
          // 10 minutes in the future — well beyond the 60s clock-skew tolerance.
          alerted_at: new Date(now + 10 * 60_000).toISOString(),
        }),
      ],
      now
    );
    assert.equal(pulse.printsLast15m, 1, "the future-dated print must be excluded, not counted as freshest");
  });

  // A print only slightly ahead of `now` — ordinary clock skew, within tolerance — still counts,
  // matching signalWindowAgeMs's own documented tolerance rationale.
  test("a print a few seconds ahead of now (ordinary clock skew) is still counted", () => {
    const now = Date.parse("2026-09-01T15:00:00.000Z");
    const pulse = computeHelixSessionPulse(
      [
        flow({
          ticker: "SPY",
          premium: 500_000,
          alerted_at: new Date(now + 5_000).toISOString(),
        }),
      ],
      now
    );
    assert.equal(pulse.printsLast15m, 1);
  });
});

describe("sessionPulseBullPct", () => {
  // BUG FIX (2026-10-25): live repro on /flows — directionLabel correctly reads a tape as
  // "undetermined" ("Unreadable" in the UI) whenever the undetermined premium outweighs the
  // readable bullish+bearish premium, but the pulse bar's own bullPct used to be computed
  // independently from bullish/bearish alone, ignoring undetermined entirely — so it rendered a
  // confident-looking "45% bull / 55% bear" split directly under a label that says the read is
  // unreadable. sessionPulseBullPct now returns null whenever directionRead is "undetermined",
  // matching the label exactly.
  test("returns null when directionRead is undetermined, even though bullish/bearish alone would split cleanly", () => {
    const now = Date.parse("2026-10-25T12:00:00.000Z");
    const pulse = computeHelixSessionPulse(
      [
        // Readable minority: $45K bullish (call bought), $55K bearish (put bought) — a clean
        // 45/55 split on its own.
        flow({ ticker: "SPX", premium: 45_000, option_type: "CALL", ask_pct: 80 }),
        flow({ ticker: "SPX", premium: 55_000, option_type: "PUT", ask_pct: 80 }),
        // Dominant undetermined premium (midpoint ask_pct) — more than the $100K readable total,
        // which is exactly directionLabel's own "undetermined > readable" rule.
        flow({ ticker: "SPX", premium: 500_000, option_type: "CALL", ask_pct: 50 }),
      ],
      now
    );
    assert.equal(pulse.directionRead, "undetermined");
    assert.equal(sessionPulseBullPct(pulse), null);
  });

  test("returns a percentage for a readable mixed split", () => {
    const now = Date.parse("2026-10-25T12:00:00.000Z");
    const pulse = computeHelixSessionPulse(
      [
        flow({ ticker: "SPX", premium: 45_000, option_type: "CALL", ask_pct: 80 }),
        flow({ ticker: "SPX", premium: 55_000, option_type: "PUT", ask_pct: 80 }),
      ],
      now
    );
    assert.equal(pulse.directionRead, "mixed");
    assert.equal(sessionPulseBullPct(pulse), 45);
  });

  test("returns null when there is no readable premium at all", () => {
    const now = Date.parse("2026-10-25T12:00:00.000Z");
    const pulse = computeHelixSessionPulse(
      [flow({ ticker: "SPX", premium: 100_000, option_type: "CALL", ask_pct: 50 })],
      now
    );
    assert.equal(pulse.directionRead, "undetermined");
    assert.equal(sessionPulseBullPct(pulse), null);
  });
});
