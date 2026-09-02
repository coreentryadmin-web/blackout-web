import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildZeroDteTradePayload,
  formatZeroDteExpiry,
  formatZeroDteStrike,
} from "./discord-trade-notify";

describe("discord-trade-notify formatters", () => {
  test("formatZeroDteExpiry maps ISO to M/D", () => {
    assert.equal(formatZeroDteExpiry("2026-10-10"), "10/10");
    assert.equal(formatZeroDteExpiry("2026-01-05"), "1/5");
    assert.equal(formatZeroDteExpiry(null), null);
  });

  test("formatZeroDteStrike maps direction to C/P", () => {
    assert.equal(formatZeroDteStrike(7650, "long"), "7650C");
    assert.equal(formatZeroDteStrike(180, "short"), "180P");
    assert.equal(formatZeroDteStrike(null, "long"), null);
  });

  test("buildZeroDteTradePayload matches manual desk format", () => {
    const payload = buildZeroDteTradePayload(
      {
        session_date: "2026-10-10",
        ticker: "SPX",
        direction: "long",
        top_strike: 7650,
        expiry: "2026-10-10",
        entry_premium: 3.55,
      },
      "BTO",
      3.55
    );
    assert.deepEqual(payload, {
      action: "BTO",
      qty: 1,
      ticker: "SPX",
      strike: "7650C",
      expiry: "10/10",
      price: 3.55,
      idempotency_key: "zerodte:2026-10-10:SPX:bto",
      author_name: "BlackOut Desk",
    });
  });

  test("buildZeroDteTradePayload skips condor rows", () => {
    const payload = buildZeroDteTradePayload(
      {
        session_date: "2026-10-10",
        ticker: "SPY",
        direction: "long",
        top_strike: 500,
        expiry: "2026-10-10",
        entry_premium: 1.2,
        play_type: "CONDOR",
      },
      "BTO",
      1.2
    );
    assert.equal(payload, null);
  });
});
