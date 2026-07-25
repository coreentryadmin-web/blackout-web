import { test } from "node:test";
import assert from "node:assert/strict";
import { zeroDteSources, isBoardDegraded, type BoardResp } from "./zerodte-sources.ts";

test("isBoardDegraded: null (first load) is NOT degraded; available:false / degraded / upstream_ok:false are", () => {
  assert.equal(isBoardDegraded(null), false);
  assert.equal(isBoardDegraded(undefined), false);
  assert.equal(isBoardDegraded({ available: true, upstream_ok: true }), false);
  assert.equal(isBoardDegraded({ available: false }), true);
  assert.equal(isBoardDegraded({ degraded: true }), true);
  assert.equal(isBoardDegraded({ upstream_ok: false }), true);
});

test("zeroDteSources: a gate-BLOCKED fresh find is a SKIP, not a WATCH (9-6a)", () => {
  const resp: BoardResp = { setups: [{ ticker: "nvda", score: 70, gate: { verdict: "BLOCKED" } }], ledger: [] };
  const [s] = zeroDteSources(resp);
  assert.equal(s!.ticker, "NVDA");
  assert.equal(s!.status, "SKIP");
});

test("zeroDteSources: a fresh find with no ledger + non-blocked gate is a WATCH", () => {
  const resp: BoardResp = { setups: [{ ticker: "amd", score: 66, gate: { verdict: "WATCH" } }] };
  assert.equal(zeroDteSources(resp)[0]!.status, "WATCH");
});

test("zeroDteSources: a committed ledger status wins over the gate verdict", () => {
  const resp: BoardResp = {
    setups: [{ ticker: "aapl", score: 80, gate: { verdict: "BLOCKED" } }],
    ledger: [{ ticker: "AAPL", status: "OPEN", entry_premium: 4, last_mark: 5, live_pnl_pct: 25 }],
  };
  const [s] = zeroDteSources(resp);
  assert.equal(s!.status, "OPEN");
  assert.equal(s!.live_pnl_pct, 25);
});

test("zeroDteSources: an OPEN ledger position the scan didn't surface is UNIONED in, never dropped (9-4)", () => {
  const resp: BoardResp = {
    setups: [{ ticker: "spy", score: 70 }], // scan surfaces SPY only
    ledger: [
      { ticker: "SPY", status: "WATCH" },
      { ticker: "NVDA", status: "HOLD", direction: "long", top_strike: 180, entry_premium: 4, last_mark: 6, live_pnl_pct: 50, peak_premium: 7, trough_premium: 3.5 },
      { ticker: "TSLA", status: "CLOSED" }, // closed → NOT unioned
    ],
  };
  const out = zeroDteSources(resp);
  const tks = out.map((s) => s.ticker).sort();
  assert.deepEqual(tks, ["NVDA", "SPY"]); // NVDA present (open), TSLA absent (closed)
  const nvda = out.find((s) => s.ticker === "NVDA")!;
  assert.equal(nvda.status, "HOLD");
  assert.equal(nvda.live_pnl_pct, 50);
  assert.equal(nvda.peak_premium, 7); // peak/trough carried so the PnL panel excursion renders (9-7)
  assert.equal(nvda.trough_premium, 3.5);
  assert.equal(nvda.setup?.direction, "long"); // synthesized so the card isn't blank
});

test("zeroDteSources: a working position already in the setups list is not duplicated", () => {
  const resp: BoardResp = {
    setups: [{ ticker: "nvda", score: 70 }],
    ledger: [{ ticker: "NVDA", status: "OPEN" }],
  };
  assert.equal(zeroDteSources(resp).length, 1);
});

test("zeroDteSources: Terminal v2 fields (exit_policy, greeks, book, executable, origin, tier) pass through from the ledger row", () => {
  const ladder = {
    policy: "trim_scale", hard_stop_pct: -50, target_pct: 100,
    trim_levels: [{ trigger_pct: 25, fraction: 0.333, premium: 2.5, fired: true }],
    runner_fraction: 0.333, stop_premium: 1.0, target_premium: 4.0, time_stop_et: "15:30",
  };
  const resp: BoardResp = {
    setups: [{ ticker: "nvda", score: 80, confluence: { confirmations: 2 } }],
    ledger: [{
      ticker: "NVDA", status: "OPEN", direction: "long", top_strike: 182,
      entry_premium: 2.0, last_mark: 2.6, live_pnl_pct: 30, peak_premium: 2.6,
      exit_policy: ladder, bid: 2.55, ask: 2.65, live_pnl_pct_exec: 27.5,
      greeks: { delta: 0.5, gamma: 0.06, theta: -0.18, vega: 0.1, iv: 0.44 },
      mark_as_of: "2026-07-25T14:00:00.000Z", mark_is_sync: false,
      discovery_origin: ["FLOW"], tier: { tier: "A" },
    }],
  };
  const [s] = zeroDteSources(resp);
  assert.equal(s!.exit_policy!.policy, "trim_scale");
  assert.equal(s!.bid, 2.55);
  assert.equal(s!.live_pnl_pct_exec, 27.5);
  assert.equal(s!.greeks!.theta, -0.18);
  assert.equal(s!.mark_as_of, "2026-07-25T14:00:00.000Z");
  assert.deepEqual(s!.discovery_origin, ["FLOW"]);
  assert.equal(s!.tier!.tier, "A");
  assert.equal(s!.confluence, 2); // read off the SETUP's confluence.confirmations
});

test("zeroDteSources: a legacy ledger row without Terminal v2 fields yields nulls (no fabrication)", () => {
  const resp: BoardResp = {
    ledger: [{ ticker: "SPY", status: "HOLD", direction: "long", entry_premium: 4, last_mark: 4.2 }],
  };
  const [s] = zeroDteSources(resp);
  assert.equal(s!.exit_policy, null);
  assert.equal(s!.greeks, null);
  assert.equal(s!.bid, null);
  assert.equal(s!.discovery_origin, null);
  assert.equal(s!.tier, null);
  assert.equal(s!.confluence, null);
});
