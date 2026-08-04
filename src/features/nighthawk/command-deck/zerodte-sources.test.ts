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
  const resp: BoardResp = {
    session: { heat: { state: "RTH" } },
    setups: [{ ticker: "nvda", score: 70, gate: { verdict: "BLOCKED" } }],
    ledger: [],
  };
  const [s] = zeroDteSources(resp);
  assert.equal(s!.ticker, "NVDA");
  assert.equal(s!.status, "SKIP");
});

test("zeroDteSources: a fresh find with no ledger + non-blocked gate is a WATCH", () => {
  const resp: BoardResp = {
    session: { heat: { state: "RTH" } },
    setups: [{ ticker: "amd", score: 66, gate: { verdict: "WATCH" } }],
  };
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

test("zeroDteSources: WORKING + CLOSED ledger positions the scan didn't surface are UNIONED in (9-4)", () => {
  const resp: BoardResp = {
    setups: [{ ticker: "spy", score: 70 }], // scan surfaces SPY only
    ledger: [
      { ticker: "SPY", status: "WATCH" },
      { ticker: "NVDA", status: "HOLD", direction: "long", top_strike: 180, entry_premium: 4, last_mark: 6, live_pnl_pct: 50, peak_premium: 7, trough_premium: 3.5 },
      { ticker: "TSLA", status: "CLOSED" }, // closed → UNIONED so it appears under "Closed" filter
    ],
  };
  const out = zeroDteSources(resp);
  const tks = out.map((s) => s.ticker).sort();
  assert.deepEqual(tks, ["NVDA", "SPY", "TSLA"]); // NVDA (open) + TSLA (closed) both unioned
  const nvda = out.find((s) => s.ticker === "NVDA")!;
  assert.equal(nvda.status, "HOLD");
  assert.equal(nvda.live_pnl_pct, 50);
  assert.equal(nvda.peak_premium, 7); // peak/trough carried so the PnL panel excursion renders (9-7)
  assert.equal(nvda.trough_premium, 3.5);
  assert.equal(nvda.setup?.direction, "long"); // synthesized so the card isn't blank
  const tsla = out.find((s) => s.ticker === "TSLA")!;
  assert.equal(tsla.status, "CLOSED");
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

test("zeroDteSources: WATCH setup plan.mark/bid/ask/occ plumb when ledger has no mark (right-rail not static)", () => {
  // Prod 2026-07-28 after-hours: marks SSE returns stale nulls, but board setups carry plan.mark.
  // Without this plumbing the Thesis/Management/PnL panels show "—" forever off the live lane.
  const resp: BoardResp = {
    session: { heat: { state: "RTH" } },
    setups: [{
      ticker: "MU",
      score: 83,
      underlying_price: 819.94,
      market_aligned: true,
      gate: { verdict: "WATCH" },
      plan: { occ: "O:MU260729C00825000", mark: 21.38, bid: 21.1, ask: 21.65, stop_premium: 10.69, target_premium: 42.76 },
    }],
    ledger: [],
  };
  const [s] = zeroDteSources(resp);
  assert.equal(s!.status, "WATCH");
  assert.equal(s!.last_mark, 21.38);
  assert.equal(s!.bid, 21.1);
  assert.equal(s!.ask, 21.65);
  assert.equal(s!.occ, "O:MU260729C00825000");
  assert.equal(s!.mark_is_sync, true); // plan quote, no per-tick mark_as_of
  assert.equal(s!.underlying_price, 819.94);
});

test("zeroDteSources: POST_COMMIT heat + MOVED/illiquid fresh finds resolve to SKIP (9-6a session heat)", () => {
  const postCommit: BoardResp = {
    session: { heat: { state: "POST_COMMIT" } },
    setups: [{ ticker: "spy", score: 70, gate: { verdict: "WATCH" } }],
    ledger: [],
  };
  assert.equal(zeroDteSources(postCommit)[0]!.status, "SKIP");

  const moved: BoardResp = {
    session: { heat: { state: "RTH" } },
    setups: [{ ticker: "nvda", score: 70, gate: { verdict: "WATCH" }, plan: { entry_status: "MOVED" } }],
    ledger: [],
  };
  assert.equal(zeroDteSources(moved)[0]!.status, "SKIP");

  const illiquid: BoardResp = {
    session: { heat: { state: "RTH" } },
    setups: [{ ticker: "amd", score: 66, gate: { verdict: "WATCH" }, plan: { illiquid: true } }],
    ledger: [],
  };
  assert.equal(zeroDteSources(illiquid)[0]!.status, "SKIP");
});

test("zeroDteSources: after close, fresh finds are omitted unless a ledger row exists", () => {
  const resp: BoardResp = {
    session: { heat: { state: "CLOSED" } },
    setups: [
      { ticker: "spy", score: 70, gate: { verdict: "WATCH" } },
      { ticker: "nvda", score: 80, gate: { verdict: "WATCH" } },
    ],
    ledger: [{ ticker: "NVDA", status: "CLOSED", direction: "long", top_strike: 180 }],
  };
  const out = zeroDteSources(resp);
  assert.deepEqual(out.map((s) => s.ticker).sort(), ["NVDA"]);
  assert.equal(out[0]!.status, "CLOSED");
});

test("zeroDteSources: WATCH/SKIP rows null live_pnl_pct even when ledger carries a stale pct", () => {
  const resp: BoardResp = {
    setups: [{ ticker: "mu", score: 70, gate: { verdict: "WATCH" } }],
    ledger: [{ ticker: "MU", status: "WATCH", live_pnl_pct: 12 }],
  };
  assert.equal(zeroDteSources(resp)[0]!.live_pnl_pct, null);
});

test("zeroDteSources: ledger occ wins + synthesizes plan on ledger-only working rows", () => {
  const resp: BoardResp = {
    setups: [],
    ledger: [{
      ticker: "NVDA",
      status: "OPEN",
      direction: "long",
      top_strike: 190,
      entry_premium: 2.0,
      last_mark: 2.4,
      occ: "O:NVDA260729C00190000",
      live_pnl_pct: 20,
    }],
  };
  const [s] = zeroDteSources(resp);
  assert.equal(s!.occ, "O:NVDA260729C00190000");
  assert.equal(s!.setup?.plan?.occ, "O:NVDA260729C00190000");
  assert.equal(s!.last_mark, 2.4);
});
