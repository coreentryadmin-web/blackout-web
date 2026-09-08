import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildZeroDteTradePayload,
  chiefTradePostBodySucceeded,
  chiefTradeVirtualLots,
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

  test("buildZeroDteTradePayload matches manual desk format (qty=1 default)", () => {
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
      author_name: "Night-Hawk-Bot",
    });
  });

  test("buildZeroDteTradePayload close uses remaining virtual lots after trims", () => {
    const prev = process.env.CHIEF_TRADE_VIRTUAL_LOTS;
    process.env.CHIEF_TRADE_VIRTUAL_LOTS = "3";
    try {
      assert.equal(chiefTradeVirtualLots(), 3);
      const payload = buildZeroDteTradePayload(
        {
          session_date: "2026-10-10",
          ticker: "SPX",
          direction: "long",
          top_strike: 7650,
          expiry: "2026-10-10",
          entry_premium: 3.55,
          trims_taken: 2,
        },
        "STC",
        5.1,
        { idempotencySuffix: "stc" }
      );
      assert.equal(payload?.qty, 1);
      assert.equal(payload?.idempotency_key, "zerodte:2026-10-10:SPX:stc");
    } finally {
      if (prev === undefined) delete process.env.CHIEF_TRADE_VIRTUAL_LOTS;
      else process.env.CHIEF_TRADE_VIRTUAL_LOTS = prev;
    }
  });

  test("chiefTradePostBodySucceeded treats duplicate as success", () => {
    assert.equal(chiefTradePostBodySucceeded({ duplicate: true }), true);
    assert.equal(chiefTradePostBodySucceeded({ ok: true }), true);
    assert.equal(chiefTradePostBodySucceeded({ ok: false }), false);
    assert.equal(chiefTradePostBodySucceeded(null), true);
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
