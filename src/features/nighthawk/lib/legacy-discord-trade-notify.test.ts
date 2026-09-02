import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { PlaybookPlay } from "./types";
import {
  buildLegacyTradePayload,
  legacyInputFromLiveRow,
  legacyInputFromPlaybookPlay,
  legacyInputFromOutcomeRow,
  legacyOptionDirection,
  legacyOutcomeExitPremium,
} from "./legacy-discord-trade-notify";

function play(overrides: Partial<PlaybookPlay> = {}): PlaybookPlay {
  return {
    rank: 1,
    ticker: "NVDA",
    direction: "LONG",
    conviction: "A",
    play_type: "stock",
    thesis: "test",
    key_signal: "flow",
    entry_range: "$180–$185",
    target: "$200",
    stop: "$170",
    options_play: "NVDA $180 CALL @ $4.00 — Sep 19",
    entry_premium: 4,
    ...overrides,
  } as PlaybookPlay;
}

describe("legacy-discord-trade-notify", () => {
  test("legacyInputFromPlaybookPlay maps call contract", () => {
    const input = legacyInputFromPlaybookPlay("2026-09-02", play());
    assert.equal(input?.ticker, "NVDA");
    assert.equal(input?.direction, "long");
    assert.equal(input?.top_strike, 180);
    assert.equal(input?.entry_premium, 4);
    assert.match(input?.expiry ?? "", /^\d{4}-\d{2}-\d{2}$/);
  });

  test("legacyInputFromPlaybookPlay skips missing premium", () => {
    assert.equal(legacyInputFromPlaybookPlay("2026-09-02", play({ entry_premium: undefined })), null);
  });

  test("legacyOptionDirection maps PUT to short", () => {
    assert.equal(
      legacyOptionDirection(play({ options_play: "SPY $500 PUT @ $2.00 — Oct 10" })),
      "short"
    );
  });

  test("buildLegacyTradePayload matches desk format", () => {
    const input = legacyInputFromPlaybookPlay(
      "2026-09-02",
      play({
        ticker: "SPX",
        options_play: "SPX $7650 CALL @ $3.55 — Sep 2",
        entry_premium: 3.55,
      })
    );
    assert.ok(input);
    const prevCh = process.env.LEGACY_CHIEF_TRADE_CHANNEL_ID;
    delete process.env.LEGACY_CHIEF_TRADE_CHANNEL_ID;
    try {
      const payload = buildLegacyTradePayload(input!, "BTO", 3.55);
      assert.deepEqual(payload, {
        action: "BTO",
        qty: 1,
        ticker: "SPX",
        strike: "7650C",
        expiry: "9/2",
        price: 3.55,
        idempotency_key: "legacy:2026-09-02:SPX:bto",
        author_name: "night-hawk-legacy",
      });
    } finally {
      if (prevCh === undefined) delete process.env.LEGACY_CHIEF_TRADE_CHANNEL_ID;
      else process.env.LEGACY_CHIEF_TRADE_CHANNEL_ID = prevCh;
    }
  });

  test("buildLegacyTradePayload includes channel_id when LEGACY_CHIEF_TRADE_CHANNEL_ID set", () => {
    const input = legacyInputFromPlaybookPlay("2026-09-02", play());
    assert.ok(input);
    const prev = process.env.LEGACY_CHIEF_TRADE_CHANNEL_ID;
    process.env.LEGACY_CHIEF_TRADE_CHANNEL_ID = "1544793338597871636";
    try {
      const payload = buildLegacyTradePayload(input!, "BTO", 4);
      assert.equal(payload?.channel_id, "1544793338597871636");
      assert.equal(payload?.author_name, "night-hawk-legacy");
    } finally {
      if (prev === undefined) delete process.env.LEGACY_CHIEF_TRADE_CHANNEL_ID;
      else process.env.LEGACY_CHIEF_TRADE_CHANNEL_ID = prev;
    }
  });

  test("legacyInputFromOutcomeRow reads publish_context", () => {
    const input = legacyInputFromOutcomeRow({
      id: 1,
      edition_for: "2026-09-02",
      ticker: "AAPL",
      direction: "LONG",
      conviction: "A",
      entry_range_low: 180,
      entry_range_high: 185,
      target: 200,
      stop: 170,
      score: 90,
      sector: "tech",
      outcome: "pending",
      publish_context: {
        final_output: {
          options_play: "AAPL $190 CALL @ $3.20 — Sep 12",
          entry_premium: 3.2,
        },
      },
    } as never);
    assert.equal(input?.ticker, "AAPL");
    assert.equal(input?.top_strike, 190);
    assert.equal(input?.entry_premium, 3.2);
  });

  test("legacyInputFromOutcomeRow reads flat PR-N4 publish_context", () => {
    const input = legacyInputFromOutcomeRow({
      id: 1,
      edition_for: "2026-09-03",
      ticker: "DELL",
      direction: "LONG",
      conviction: "A",
      outcome: "pending",
      publish_context: {
        entry_premium: 12.85,
        options_play: "DELL $490 CALL @ $12.85 — Sep 4",
      },
    } as never);
    assert.equal(input?.ticker, "DELL");
    assert.equal(input?.top_strike, 490);
    assert.equal(input?.entry_premium, 12.85);
  });

  test("legacyInputFromLiveRow uses resolved contract without publish_context", () => {
    const input = legacyInputFromLiveRow({
      id: 1,
      edition_for: "2026-09-03",
      ticker: "DELL",
      direction: "LONG",
      conviction: "A",
      outcome: "pending",
      contract_occ: "DELL260904C00490000",
      entry_premium: 12.85,
      exit_style: "scale_out",
      options_play: "DELL $490 CALL @ $12.85 — Sep 4",
    } as never);
    assert.equal(input?.ticker, "DELL");
    assert.equal(input?.top_strike, 490);
    assert.equal(input?.entry_premium, 12.85);
    assert.equal(input?.direction, "long");
  });

  test("legacyInputFromLiveRow falls back to OCC when options_play missing", () => {
    const input = legacyInputFromLiveRow({
      id: 1,
      edition_for: "2026-09-02",
      ticker: "NVDA",
      direction: "LONG",
      conviction: "A",
      outcome: "pending",
      contract_occ: "NVDA260919C00180000",
      entry_premium: 4,
      exit_style: null,
      options_play: "",
    } as never);
    assert.equal(input?.top_strike, 180);
    assert.equal(input?.expiry, "2026-09-19");
  });

  test("legacyOutcomeExitPremium scales target/stop", () => {
    assert.equal(legacyOutcomeExitPremium(4, "target"), 5.4);
    assert.equal(legacyOutcomeExitPremium(4, "stop"), 2.6);
    assert.equal(legacyOutcomeExitPremium(4, "open"), 4);
  });
});
