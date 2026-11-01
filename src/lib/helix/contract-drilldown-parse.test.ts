import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseContractFills,
  parseContractIntraday,
  parseContractMeta,
  volumeProfileBidAskPct,
} from "./contract-drilldown-parse";

test("parseContractFills maps UW live shape", () => {
  const rows = parseContractFills([
    {
      size: 13,
      price: "22.00",
      premium: "28600.00",
      executed_at: "2026-07-10T20:53:02.839559Z",
      tags: ["mid_side", "floor"],
    },
  ]);
  assert.equal(rows[0].size, 13);
  assert.equal(rows[0].fill, 22);
  assert.equal(rows[0].premium, 28600);
});

test("parseContractIntraday sums volume sides", () => {
  const rows = parseContractIntraday([
    {
      start_time: "2026-07-10T19:53:00Z",
      volume_mid_side: 195,
      volume_ask_side: 0,
      volume_bid_side: 0,
      avg_price: "23.00",
      premium_mid_side: 448500,
    },
  ]);
  assert.equal(rows[0].volume, 195);
  assert.equal(rows[0].avg_price, 23);
  assert.equal(rows[0].premium, 448500);
});

test("volumeProfileBidAskPct from price levels", () => {
  const pct = volumeProfileBidAskPct([
    { ask_vol: 10, bid_vol: 40 },
    { ask_vol: 0, bid_vol: 60 },
  ]);
  assert.equal(pct, 90.9);
});

test("parseContractMeta reads OI from first fill", () => {
  const meta = parseContractMeta([{ open_interest: 23510, volume: 1337, implied_volatility: 0.24, delta: -0.06 }]);
  assert.equal(meta.open_interest, 23510);
  assert.equal(meta.day_volume, 1337);
});

test("parseContractMeta preserves a genuine zero open_interest/day_volume instead of nulling it", () => {
  // A brand-new, never-yet-traded contract (or one with zero volume so far this session) carries
  // a real `0` from UW, not a missing field. `0` must survive as `0`, not collapse to `null` —
  // the drawer treats `null` as "unknown" (hides the stat chip) and `0` as "nobody has traded this
  // yet" (shows "0"), and those are different, both meaningful, facts.
  const meta = parseContractMeta([
    { open_interest: 0, volume: 0, underlying_price: 142.5, implied_volatility: 0.31, delta: -0.12 },
  ]);
  assert.equal(meta.open_interest, 0);
  assert.equal(meta.day_volume, 0);
});

test("parseContractMeta reports null (not a fabricated 0) when there is no flow data at all", () => {
  // No rows means we never observed open_interest/day_volume/delta for this contract — that is
  // genuinely unknown, not "0". A fix for the genuine-zero bug above must not overcorrect into
  // treating "missing" the same as "zero" the other way.
  const meta = parseContractMeta([]);
  assert.equal(meta.open_interest, null);
  assert.equal(meta.day_volume, null);
  assert.equal(meta.underlying_price, null);
  assert.equal(meta.delta, null);
});
