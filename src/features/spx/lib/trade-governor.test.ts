import test from "node:test";
import assert from "node:assert/strict";
import {
  applyTradeGovernorOptionOverlay,
  evaluateTradeGovernor,
  mergeTradeGovernorWithOptionOverlay,
} from "./trade-governor";

test("evaluateTradeGovernor: session loss cap halts entries", () => {
  const result = evaluateTradeGovernor({
    buy_intent: true,
    playbook_id: "PB-01",
    direction: "long",
    desk: { vix: 16 },
    session: { session_losses_today: 3, last_buy_at: null, last_sell_at: null, last_sell_was_loss: false, last_direction: null, last_stop_at: null },
  });
  assert.ok(result.blocks.some((b) => b.includes("loss cap")));
  assert.equal(result.emergency_shutdown, true);
});

test("evaluateTradeGovernor: spread widening blocks", () => {
  const result = evaluateTradeGovernor({
    buy_intent: true,
    playbook_id: "PB-03",
    direction: "long",
    desk: { vix: 16 },
    session: { last_buy_at: null, last_sell_at: null, last_sell_was_loss: false, last_direction: null, last_stop_at: null },
    option: { mid: 3, spread_pct: 22, blocked: false, block_reason: null },
  });
  assert.ok(result.blocks.some((b) => b.includes("Spread")));
});

test("evaluateTradeGovernor: bypass_buy_cooldown skips post-exit cooldown (WATCH→ENTRY promote path)", () => {
  const recentExit = Date.now() - 60_000;
  const blocked = evaluateTradeGovernor({
    buy_intent: true,
    playbook_id: "PB-01",
    direction: "long",
    desk: { vix: 16 },
    session: {
      last_buy_at: null,
      last_sell_at: recentExit,
      last_sell_was_loss: false,
      last_direction: "long",
      last_stop_at: null,
    },
  });
  assert.ok(blocked.blocks.some((b) => b.includes("Buy cooldown")));

  const bypassed = evaluateTradeGovernor({
    buy_intent: true,
    playbook_id: "PB-01",
    direction: "long",
    desk: { vix: 16 },
    session: {
      last_buy_at: null,
      last_sell_at: recentExit,
      last_sell_was_loss: false,
      last_direction: "long",
      last_stop_at: null,
    },
    bypass_buy_cooldown: true,
  });
  assert.equal(
    bypassed.blocks.some((b) => b.includes("Buy cooldown")),
    false
  );
});

test("mergeTradeGovernorWithOptionOverlay: option spread without re-running session rules", () => {
  const recentExit = Date.now() - 60_000;
  const sessionGov = evaluateTradeGovernor({
    buy_intent: true,
    playbook_id: "PB-01",
    direction: "long",
    desk: { vix: 16 },
    session: {
      last_buy_at: null,
      last_sell_at: recentExit,
      last_sell_was_loss: false,
      last_direction: "long",
      last_stop_at: null,
    },
    bypass_buy_cooldown: true,
  });
  assert.equal(sessionGov.blocks.some((b) => b.includes("Buy cooldown")), false);

  const merged = mergeTradeGovernorWithOptionOverlay(sessionGov, {
    mid: 3,
    spread_pct: 22,
    blocked: false,
    block_reason: null,
  });
  assert.ok(merged.blocks.some((b) => b.includes("Spread")));
  assert.equal(merged.blocks.some((b) => b.includes("Buy cooldown")), false);
});

test("applyTradeGovernorOptionOverlay: spread blocks only", () => {
  const overlay = applyTradeGovernorOptionOverlay({
    mid: 3,
    spread_pct: 22,
    blocked: false,
    block_reason: null,
  });
  assert.ok(overlay.blocks.some((b) => b.includes("Spread")));
});

// BUG FIX regression coverage: "consecutive loss watch" must read the REAL
// consecutive-loss streak (session_consecutive_losses_today), not the
// cumulative daily loss counter (session_losses_today) which never resets on
// a win. Before the fix, a desk winning every 3rd trade (loss, loss, WIN,
// loss, loss, WIN, ...) would trip the consecutive-loss size-down after
// trade #3 and stay tripped for the rest of the day, because
// session_losses_today only ever counts up.

test("evaluateTradeGovernor: cumulative daily losses alone do NOT trip consecutive-loss watch after a win reset the streak", () => {
  // 2 cumulative losses today (session_losses_today=2, below the separate
  // session-loss-cap of 3 so that check doesn't also fire), but the streak
  // field says the last trade was a WIN that reset the streak to 0. Below
  // the default TRADE_GOVERNOR_MAX_CONSECUTIVE_LOSSES (3) threshold, this
  // must NOT trigger the consecutive-loss size-down.
  const result = evaluateTradeGovernor({
    buy_intent: true,
    playbook_id: "PB-01",
    direction: "long",
    desk: { vix: 16 },
    session: {
      session_losses_today: 2,
      session_consecutive_losses_today: 0,
      last_buy_at: null,
      last_sell_at: null,
      last_sell_was_loss: false,
      last_direction: null,
      last_stop_at: null,
    },
  });
  assert.ok(!result.warnings.some((w) => w.includes("Consecutive loss watch")));
  assert.equal(result.size_multiplier, 1);
  assert.equal(result.tier, "normal");
});

test("evaluateTradeGovernor: real consecutive-loss streak at threshold trips the size-down", () => {
  const result = evaluateTradeGovernor({
    buy_intent: true,
    playbook_id: "PB-01",
    direction: "long",
    desk: { vix: 16 },
    session: {
      // Cumulative losses today is below the separate session-loss-cap (3)
      // so only the consecutive-loss check under test can fire. In reality
      // session_losses_today >= session_consecutive_losses_today always,
      // but the point of this test is that the WATCH threshold reads the
      // trailing streak field, not the cumulative one.
      session_losses_today: 2,
      session_consecutive_losses_today: 3,
      last_buy_at: null,
      last_sell_at: null,
      last_sell_was_loss: true,
      last_direction: null,
      last_stop_at: null,
    },
  });
  assert.ok(result.warnings.some((w) => w.includes("Consecutive loss watch (3/3)")));
  assert.equal(result.size_multiplier, 0.5);
  assert.equal(result.tier, "reduced");
});

test("evaluateTradeGovernor: missing session_consecutive_losses_today defaults to 0 (no false trip)", () => {
  const result = evaluateTradeGovernor({
    buy_intent: true,
    playbook_id: "PB-01",
    direction: "long",
    desk: { vix: 16 },
    session: {
      session_losses_today: 2,
      last_buy_at: null,
      last_sell_at: null,
      last_sell_was_loss: false,
      last_direction: null,
      last_stop_at: null,
    },
  });
  assert.ok(!result.warnings.some((w) => w.includes("Consecutive loss watch")));
});
