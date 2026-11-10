import test from "node:test";
import assert from "node:assert/strict";
import { loadGexPositioningPairForIntegrity } from "./data-integrity-gex-load";
import type { GexPositioning } from "@/lib/providers/gex-positioning";

function fakePos(ticker: string): GexPositioning {
  return {
    ticker,
    spot: 100,
    change_pct: 0,
    asof: new Date().toISOString(),
    net_gex: 0,
    gamma_posture: null,
    gamma_regime_read: "",
    net_vex: 0,
    vanna_posture: null,
    vanna_regime_read: "",
    flip: null,
    call_wall: null,
    put_wall: null,
    max_pain: null,
    gex_king_strike: null,
    freshness: "cached",
    as_of_et: "",
    session_date: "2026-01-01",
    market_session: "OPEN",
    matrix_age_sec: 1,
  };
}

test("loadGexPositioningPairForIntegrity: succeeds on first attempt when both present", async () => {
  const calls: string[] = [];
  const read = async (ticker: string) => {
    calls.push(ticker);
    return fakePos(ticker);
  };
  const { spx, spy } = await loadGexPositioningPairForIntegrity(read, [0]);
  assert.ok(spx);
  assert.ok(spy);
  assert.deepEqual(calls, ["SPX", "SPY"]);
});

test("loadGexPositioningPairForIntegrity: retries after circuit-open null without double-hitting warm cache", async () => {
  const attempts = new Map<string, number>([
    ["SPX", 0],
    ["SPY", 0],
  ]);
  const read = async (ticker: string) => {
    const n = (attempts.get(ticker) ?? 0) + 1;
    attempts.set(ticker, n);
    if (n === 1) return null;
    return fakePos(ticker);
  };
  const { spx, spy } = await loadGexPositioningPairForIntegrity(read, [0, 1, 1]);
  assert.ok(spx);
  assert.ok(spy);
  assert.equal(attempts.get("SPX"), 2);
  assert.equal(attempts.get("SPY"), 2);
});
