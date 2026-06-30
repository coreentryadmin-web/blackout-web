import { test } from "node:test";
import assert from "node:assert/strict";
import type { UserPositionRow } from "@/lib/db";
import type { OptionSnapshot } from "@/lib/providers/options-snapshot";
import {
  positionNeedsChainFallback,
  snapshotMatchesPosition,
} from "@/lib/nights-watch/snapshot-coverage";

const basePosition: UserPositionRow = {
  id: 1,
  user_id: "user_1",
  ticker: "SPX",
  expiry: "2025-06-20",
  strike: 5850,
  option_type: "call",
  contracts: 1,
  side: "long",
  entry_premium: 10,
  status: "open",
  created_at: new Date(),
  updated_at: new Date(),
  exit_premium: null,
  notes: null,
};

const snap: OptionSnapshot = {
  ticker: "O:SPXW250620C05850000",
  mark: 10.2,
  bid: 10,
  ask: 10.4,
  last: 10.1,
  dayClose: 9.85,
  delta: 0.55,
  gamma: 0.01,
  theta: -0.4,
  vega: 1.2,
  iv: 0.21,
  openInterest: 1234,
  underlyingPrice: 5872.5,
  strike: 5850,
  optionType: "call",
  expiry: "2025-06-20",
  sharesPerContract: 100,
};

test("snapshotMatchesPosition: matching OCC identity", () => {
  assert.equal(snapshotMatchesPosition(basePosition, snap), true);
});

test("snapshotMatchesPosition: strike mismatch → false", () => {
  assert.equal(snapshotMatchesPosition({ ...basePosition, strike: 5900 }, snap), false);
});

test("positionNeedsChainFallback: closed leg never needs chain", () => {
  assert.equal(
    positionNeedsChainFallback({ ...basePosition, status: "closed" }, null, null),
    false
  );
});

test("positionNeedsChainFallback: priced snapshot skips chain", () => {
  assert.equal(positionNeedsChainFallback(basePosition, snap, null), false);
});

test("positionNeedsChainFallback: missing snapshot needs chain", () => {
  assert.equal(positionNeedsChainFallback(basePosition, null, null), true);
});

test("positionNeedsChainFallback: no-quote snapshot needs chain", () => {
  const noQuote = { ...snap, mark: null, bid: null, ask: null, last: null, dayClose: null };
  assert.equal(positionNeedsChainFallback(basePosition, noQuote, null), true);
});

test("positionNeedsChainFallback: live WS mark covers no-quote snapshot", () => {
  const noQuote = { ...snap, mark: null, bid: null, ask: null, last: null, dayClose: null };
  assert.equal(
    positionNeedsChainFallback(basePosition, noQuote, { mark: 9.5, bid: 9.4, ask: 9.6, ts: Date.now() }),
    false
  );
});
