import { test } from "node:test";
import assert from "node:assert/strict";
import {
  uwRowsFromStrikeLadder,
  strikeLadderFromUwRows,
  resolveSpxOdteUwLadderSource,
  normalizeUwOdteSpotExposureRows,
  resolveSpxOdteUwOracleExpiry,
} from "./spx-odte-uw-ladder";

test("uwRowsFromStrikeLadder normalizes net to call_gamma_oi rows", () => {
  const rows = uwRowsFromStrikeLadder(
    new Map([
      [7750, 835_268_500],
      [7900, 200_000_100],
    ])
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].strike, 7750);
  assert.equal(Number(rows[0].call_gamma_oi) + Number(rows[0].put_gamma_oi), 835_268_500);
});

test("strikeLadderFromUwRows round-trips normalized rows", () => {
  const rows = [
    { strike: 7750, call_gamma_oi: 100, put_gamma_oi: -20 },
    { strike: 7900, call_gamma_oi: 50, put_gamma_oi: 0 },
  ];
  const ladder = strikeLadderFromUwRows(rows);
  assert.equal(ladder.get(7750), 80);
  assert.equal(ladder.get(7900), 50);
});

test("resolveSpxOdteUwLadderSource prefers REST 0DTE over WS when both present", () => {
  const rest = {
    rows: [{ strike: 7775, call_gamma_oi: 900, put_gamma_oi: 0 }],
    source: "spot-exposures/expiry-strike (0DTE)",
  };
  const ws = {
    rows: [{ strike: 7480, call_gamma_oi: 800, put_gamma_oi: 0 }],
    source: "gex_strike_expiry WS (0DTE)",
  };
  const picked = resolveSpxOdteUwLadderSource(rest, ws);
  assert.equal(picked.source, rest.source);
  assert.equal(Number(picked.rows[0].strike), 7775);
});

test("resolveSpxOdteUwLadderSource falls back to WS when REST empty", () => {
  const ws = {
    rows: [{ strike: 7480, call_gamma_oi: 800, put_gamma_oi: 0 }],
    source: "gex_strike_expiry WS (0DTE)",
  };
  const picked = resolveSpxOdteUwLadderSource({ rows: [], source: "none" }, ws);
  assert.equal(picked.source, ws.source);
  assert.equal(Number(picked.rows[0].strike), 7480);
});

test("normalizeUwOdteSpotExposureRows maps net-only UW rows", () => {
  const rows = normalizeUwOdteSpotExposureRows([{ strike: 7775, net_gex: 42 }]);
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].call_gamma_oi) + Number(rows[0].put_gamma_oi), 42);
});

test("resolveSpxOdteUwOracleExpiry matches heatmap front-expiry fallback", () => {
  assert.equal(resolveSpxOdteUwOracleExpiry(["2026-08-20", "2026-08-21"], "2026-08-19"), "2026-08-20");
  assert.equal(resolveSpxOdteUwOracleExpiry(["2026-08-19", "2026-08-20"], "2026-08-19"), "2026-08-19");
});
