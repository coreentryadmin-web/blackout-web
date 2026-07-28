import assert from "node:assert/strict";
import test from "node:test";
import { pickAffordableChainContract } from "./play-backfill";
import { buildDirectionalStockLevels } from "./play-levels";
import { validatePlayGeometry } from "./play-constraints";
import type { PlaybookPlay } from "./types";
import type { ChainStrikeRow, EditionChainData } from "./option-chain-prompt";

const rows: ChainStrikeRow[] = [
  {
    expiry: "2026-07-17",
    strike: 200,
    call_bid: 4.5,
    call_ask: 5.0,
    call_delta: 0.55,
    call_oi: 5000,
    call_iv: 0.4,
    put_bid: 3,
    put_ask: 3.5,
    put_delta: -0.45,
    put_oi: 4000,
    put_iv: 0.4,
  },
  {
    expiry: "2026-07-17",
    strike: 210,
    call_bid: 2.5,
    call_ask: 3.0,
    call_delta: 0.4,
    call_oi: 800,
    call_iv: 0.38,
    put_bid: 5,
    put_ask: 5.5,
    put_delta: -0.6,
    put_oi: 1200,
    put_iv: 0.42,
  },
];

const chain: EditionChainData = { spot: 205, rows };

test("pickAffordableChainContract: long picks nearest liquid affordable call", () => {
  const picked = pickAffordableChainContract("NET", "long", chain);
  assert.ok(picked);
  assert.equal(picked!.entry_premium, 5);
  assert.match(picked!.options_play, /NET \$200 Call 2026-07-17/);
});

test("pickAffordableChainContract: short picks put side", () => {
  const picked = pickAffordableChainContract("NET", "short", chain);
  assert.ok(picked);
  assert.match(picked!.options_play, /Put/);
});

test("pickAffordableChainContract: returns null when no affordable liquid contracts", () => {
  const expensive: EditionChainData = {
    spot: 205,
    rows: rows.map((r) => ({ ...r, call_ask: 40, put_ask: 40 })),
  };
  assert.equal(pickAffordableChainContract("NET", "long", expensive), null);
});

test("buildDirectionalStockLevels: LONG backfill shape passes geometry gate", () => {
  const levels = buildDirectionalStockLevels({ direction: "long", support: 60.72, resistance: 71.01 });
  const play: PlaybookPlay = {
    rank: 2,
    ticker: "MAGS",
    direction: "LONG",
    conviction: "B",
    play_type: "stock",
    thesis: "",
    key_signal: "",
    options_play: "-",
    risk_note: "",
    score: 80,
    ...levels,
  };
  assert.equal(validatePlayGeometry(play).ok, true);
  assert.notEqual(levels.stop, "60.72");
});

test("buildDirectionalStockLevels: prior Near-$X + stop=X shape FAILS geometry (regression guard)", () => {
  const play: PlaybookPlay = {
    rank: 2,
    ticker: "MAGS",
    direction: "LONG",
    conviction: "B",
    play_type: "stock",
    thesis: "",
    key_signal: "",
    entry_range: "Near $60.72",
    target: "71.01",
    stop: "60.72",
    options_play: "-",
    risk_note: "",
    score: 80,
  };
  assert.equal(validatePlayGeometry(play).ok, false);
});

// ── Spot-anchored entry levels (PR-N14) ─────────────────────────────────────

test("buildDirectionalStockLevels: LONG with spot anchors entry near spot, not support", () => {
  const levels = buildDirectionalStockLevels({
    direction: "long",
    support: 174,
    resistance: 230,
    spot: 212,
  });
  // Entry should be near spot (±0.5%), NOT near support ($174)
  const play: PlaybookPlay = {
    rank: 1, ticker: "COF", direction: "LONG", conviction: "A",
    play_type: "stock", thesis: "", key_signal: "",
    options_play: "-", risk_note: "", score: 72,
    ...levels,
  };
  assert.equal(validatePlayGeometry(play).ok, true);
  // Entry band should contain values near 212
  assert.match(levels.entry_range, /\$21[0-3]/);
  // Stop clamped: support is 18% below spot, MAX_STOP_DISTANCE_PCT caps at 8%
  // 212 - min(212-174, 212*0.08) = 212 - 16.96 = 195.04
  assert.equal(levels.stop, "195.04");
  // Target at resistance (8.5% away, within 12% cap)
  assert.equal(levels.target, "230.00");
});

test("buildDirectionalStockLevels: SHORT with spot anchors entry near spot, not resistance", () => {
  const levels = buildDirectionalStockLevels({
    direction: "short",
    support: 280,
    resistance: 360,
    spot: 354,
  });
  const play: PlaybookPlay = {
    rank: 1, ticker: "GOOGL", direction: "SHORT", conviction: "B",
    play_type: "stock", thesis: "", key_signal: "",
    options_play: "-", risk_note: "", score: 67,
    ...levels,
  };
  assert.equal(validatePlayGeometry(play).ok, true);
  // Entry band near spot ($354)
  assert.match(levels.entry_range, /\$35[2-6]/);
  // Target clamped: support is 21% below spot, MAX_TARGET_DISTANCE_PCT caps at 12%
  // 354 - min(354-280, 354*0.12) = 354 - 42.48 = 311.52
  assert.equal(levels.target, "311.52");
  // Stop at resistance (1.7% away, within 8% cap)
  assert.equal(levels.stop, "360.00");
});

test("buildDirectionalStockLevels: spot-anchored entry within 3.5% of spot (publish gate compatible)", () => {
  const levels = buildDirectionalStockLevels({
    direction: "long",
    support: 174,
    resistance: 230,
    spot: 212,
  });
  // Parse entry band edges
  const nums = levels.entry_range.match(/[\d.]+/g)!.map(Number);
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  // Both edges within 0.5% of spot
  assert.ok(Math.abs(lo - 212) / 212 < 0.006, `lo ${lo} too far from spot 212`);
  assert.ok(Math.abs(hi - 212) / 212 < 0.006, `hi ${hi} too far from spot 212`);
});

test("buildDirectionalStockLevels: legacy path still works without spot (backfill compatibility)", () => {
  const levels = buildDirectionalStockLevels({
    direction: "long",
    support: 60.72,
    resistance: 71.01,
  });
  // Legacy: entry near support
  assert.match(levels.entry_range, /\$60/);
  // Regression: stop not equal to support
  assert.notEqual(levels.stop, "60.72");
});

// ── ATR-scaled entry band (overnight gap fix) ───────────────────────────────
// A fixed +-0.5% entry band is almost always unfillable for overnight plays where
// the stock gaps 2-5% at the open, directly causing band_detached/unfilled grading
// outcomes. The band should scale with ATR (half-ATR, capped at 2%) instead.

test("buildDirectionalStockLevels: LONG high-ATR name gets a wider entry band than the old fixed 0.5%", () => {
  const spot = 212;
  const atr = 12.72; // ~6% of spot -> atrPct*0.4 = 2.4%, capped at 2.5%
  const levels = buildDirectionalStockLevels({
    direction: "long",
    support: 174,
    resistance: 230,
    spot,
    atr,
  });
  const nums = levels.entry_range.match(/[\d.]+/g)!.map(Number);
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  // entryHalfWidth: (12.72/212)*0.4 = 2.4% half-band, under the 2.5% cap
  assert.ok(Math.abs(spot - lo) / spot > 0.02, `lo ${lo} band too narrow for high-ATR name`);
  assert.ok(Math.abs(hi - spot) / spot > 0.02, `hi ${hi} band too narrow for high-ATR name`);
  assert.ok(Math.abs(spot - lo) / spot <= 0.026, `lo ${lo} exceeded the 2.5% cap`);
  assert.ok(Math.abs(hi - spot) / spot <= 0.026, `hi ${hi} exceeded the 2.5% cap`);
});

test("buildDirectionalStockLevels: SHORT low-ATR name gets the floor band when ATR-scaled is below floor", () => {
  const spot = 354;
  const atr = 1.77; // 0.5% of spot -> atrPct*0.4 = 0.2% half-band, below 0.5% floor
  const levels = buildDirectionalStockLevels({
    direction: "short",
    support: 280,
    resistance: 360,
    spot,
    atr,
  });
  const nums = levels.entry_range.match(/[\d.]+/g)!.map(Number);
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  const expectedHalfBand = 0.005; // floor: MIN_ENTRY_HALF_PCT
  assert.ok(
    Math.abs(Math.abs(spot - lo) / spot - expectedHalfBand) < 0.0005,
    `lo ${lo} does not match expected floor half-band`,
  );
  assert.ok(
    Math.abs(Math.abs(hi - spot) / spot - expectedHalfBand) < 0.0005,
    `hi ${hi} does not match expected floor half-band`,
  );
});

test("buildDirectionalStockLevels: missing/zero ATR falls back to the 0.5% default band", () => {
  const spot = 100;
  const withoutAtr = buildDirectionalStockLevels({
    direction: "long",
    support: 80,
    resistance: 120,
    spot,
  });
  const withZeroAtr = buildDirectionalStockLevels({
    direction: "long",
    support: 80,
    resistance: 120,
    spot,
    atr: 0,
  });
  assert.equal(withoutAtr.entry_range, withZeroAtr.entry_range);
  const nums = withoutAtr.entry_range.match(/[\d.]+/g)!.map(Number);
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  // Floor half-band: MIN_ENTRY_HALF_PCT = 0.5%
  assert.equal(lo, 99.5);
  assert.equal(hi, 100.5);
});
